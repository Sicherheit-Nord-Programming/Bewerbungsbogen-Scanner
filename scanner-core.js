export const ID_CARD_ASPECT_RATIO = 85.6 / 53.98;
export const ID_CARD_PORTRAIT_ASPECT_RATIO = 1 / ID_CARD_ASPECT_RATIO;
export const PASSPORT_ASPECT_RATIO = 125 / 88;
export const PASSPORT_PORTRAIT_ASPECT_RATIO = 1 / PASSPORT_ASPECT_RATIO;
export const HOLD_DURATION_MS = 3_000;
export const INVALID_GRACE_MS = 650;
export const MAX_STABLE_MOVEMENT = 0.035;

export const CAPTURE_MIN_LONG_EDGE = 1_280;
export const CAPTURE_MIN_SHORT_EDGE = 720;

const MAX_ANALYSIS_LONG_EDGE = 960;
const MIN_BRIGHTNESS = 48;
const MAX_BRIGHTNESS = 222;
const MAX_CLIPPED_DARK = 0.16;
const MAX_CLIPPED_LIGHT = 0.16;
const MIN_CONTRAST = 22;
const MIN_LAPLACIAN_SHARPNESS = 9;
const MAX_GLARE_TILE = 0.68;
const MIN_GLOBAL_GLARE_SUPPORT = 0.012;

const SESSION_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STATION_PATTERN = /^[a-f0-9]{64}$/;
const APPS_SCRIPT_ENDPOINT_PATTERN = /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

export const SCANNER_DOCUMENTS = Object.freeze([
  Object.freeze({
    id: 'identity-card',
    title: 'Personalausweis',
    description: 'Vorder- und Rückseite',
    slots: Object.freeze(['id-front', 'id-back']),
  }),
  Object.freeze({
    id: 'passport',
    title: 'Reisepass',
    description: 'Datenseite',
    slots: Object.freeze(['passport-data']),
  }),
  Object.freeze({
    id: 'health-card',
    title: 'Krankenkassenkarte',
    description: 'Vorder- und Rückseite',
    slots: Object.freeze(['health-front', 'health-back']),
  }),
  Object.freeze({
    id: 'tax-id',
    title: 'Steueridentifikationsnummer',
    description: 'Eingeben oder fotografieren',
    slots: Object.freeze(['tax-id']),
    documentSetVersion: 3,
  }),
]);

export function scannerDocumentsForVersion(documentSetVersion = 2) {
  return SCANNER_DOCUMENTS.filter(
    (documentDefinition) =>
      (documentDefinition.documentSetVersion || 2) <= documentSetVersion,
  );
}

export function normalizeTaxId(value) {
  const raw = String(value ?? '');
  if (/[^0-9\s\u00a0\u2009\u202f-]/u.test(raw)) return null;
  return raw.replace(/[\s\u00a0\u2009\u202f-]/gu, '');
}

export function isPlausibleTaxId(value) {
  const normalized = normalizeTaxId(value);
  if (!normalized || !/^[1-9][0-9]{10}$/.test(normalized)) return false;

  const firstTen = normalized.slice(0, 10);
  const counts = Array.from({ length: 10 }, () => 0);
  for (const digit of firstTen) counts[Number(digit)] += 1;
  const repeated = counts
    .map((count, digit) => ({ count, digit }))
    .filter(({ count }) => count === 2 || count === 3);
  if (repeated.length !== 1) return false;
  if (
    counts.some(
      (count, digit) =>
        digit !== repeated[0].digit && count !== 0 && count !== 1,
    )
  ) {
    return false;
  }
  const absentDigits = counts.filter((count) => count === 0).length;
  if (
    (repeated[0].count === 2 && absentDigits !== 1) ||
    (repeated[0].count === 3 && absentDigits !== 2)
  ) {
    return false;
  }
  if (
    repeated[0].count === 3 &&
    firstTen.includes(String(repeated[0].digit).repeat(2))
  ) {
    return false;
  }

  let product = 10;
  for (const digit of firstTen) {
    let sum = (Number(digit) + product) % 10;
    if (sum === 0) sum = 10;
    product = (2 * sum) % 11;
  }
  let checkDigit = 11 - product;
  if (checkDigit === 10) checkDigit = 0;
  return checkDigit === Number(normalized[10]);
}

export function documentScanStatus(documentDefinition, completedSlots) {
  const completed = new Set(completedSlots);
  const completedCount = documentDefinition.slots.filter((slot) =>
    completed.has(slot),
  ).length;
  if (completedCount === 0) return 'open';
  if (completedCount === documentDefinition.slots.length) return 'complete';
  return 'in-progress';
}

export function nextDocumentSlot(documentDefinition, completedSlots) {
  const completed = new Set(completedSlots);
  return documentDefinition.slots.find((slot) => !completed.has(slot)) || null;
}

export function canCompleteDocumentSession(completedSlots) {
  const statuses = SCANNER_DOCUMENTS.map((documentDefinition) =>
    documentScanStatus(documentDefinition, completedSlots),
  );
  return statuses.includes('complete') && !statuses.includes('in-progress');
}

export function selectedDocumentPlanComplete(documentIds, completedSlots) {
  if (!documentIds || typeof documentIds[Symbol.iterator] !== 'function') {
    return false;
  }
  const selectedIds = new Set(documentIds);
  if (selectedIds.size === 0) return false;
  const selectedDocuments = SCANNER_DOCUMENTS.filter((documentDefinition) =>
    selectedIds.has(documentDefinition.id),
  );
  return (
    selectedDocuments.length === selectedIds.size &&
    selectedDocuments.every(
      (documentDefinition) =>
        documentScanStatus(documentDefinition, completedSlots) === 'complete',
    )
  );
}

export function nextSelectedPlanStep(
  documentIds,
  completedSlots,
  finalizedSlot,
) {
  const selectedIds = new Set(documentIds || []);
  const activeDocument = SCANNER_DOCUMENTS.find(
    (documentDefinition) =>
      selectedIds.has(documentDefinition.id) &&
      documentDefinition.slots.includes(finalizedSlot),
  );
  if (!activeDocument) return { kind: 'invalid' };
  const nextSlot = nextDocumentSlot(activeDocument, completedSlots);
  if (nextSlot) return { kind: 'capture', slot: nextSlot };
  return { kind: 'dashboard' };
}

function base64urlToBytes(value) {
  const base64 =
    value.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseRelayEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('Der QR-Code ist unvollständig oder ungültig.');
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.hostname !== 'script.google.com' ||
    endpoint.search ||
    endpoint.hash ||
    !APPS_SCRIPT_ENDPOINT_PATTERN.test(endpoint.pathname)
  ) {
    throw new Error('Der QR-Code ist unvollständig oder ungültig.');
  }
  return endpoint.href;
}

function decodeSecret(value) {
  let bytes;
  try {
    bytes = base64urlToBytes(value);
  } catch {
    throw new Error('Der QR-Code ist unvollständig oder ungültig.');
  }
  if (!CAPABILITY_PATTERN.test(value) || bytes.length !== 32) {
    bytes.fill(0);
    throw new Error('Der QR-Code ist unvollständig oder ungültig.');
  }
  return bytes;
}

function parseOneUseBootstrap(values) {
  const version = values.v || '';
  const sessionId = values.s || '';
  const uploadCapability = values.u || '';
  const encodedKey = values.k || '';
  const endpoint = parseRelayEndpoint(values.e || '');
  const keyBytes = decodeSecret(encodedKey);

  if (
    (version !== '1' && version !== '2') ||
    !SESSION_PATTERN.test(sessionId) ||
    !CAPABILITY_PATTERN.test(uploadCapability)
  ) {
    keyBytes.fill(0);
    throw new Error('Der QR-Code ist unvollständig oder ungültig.');
  }

  return {
    version,
    sessionId,
    uploadCapability,
    keyBytes,
    endpoint,
  };
}

/**
 * Parses a one-use v1/v2 or static v3 QR fragment without ever placing its
 * secrets in a query string. The endpoint is deliberately restricted to the
 * production Apps Script host so a forged QR code cannot redirect encrypted
 * ID material.
 */
export function parseScannerBootstrap(hash) {
  const fragment = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const version = fragment.get('v') || '';
  if (version !== '3') {
    return parseOneUseBootstrap({
      v: version,
      s: fragment.get('s') || '',
      u: fragment.get('u') || '',
      k: fragment.get('k') || '',
      e: fragment.get('e') || '',
    });
  }

  const stationId = fragment.get('d') || '';
  const encodedPairingKey = fragment.get('p') || '';
  const endpoint = parseRelayEndpoint(fragment.get('e') || '');
  const pairingKeyBytes = decodeSecret(encodedPairingKey);
  const expectedFields = ['d', 'e', 'p', 'v'];
  const actualFields = [...fragment.keys()].sort();
  if (
    !STATION_PATTERN.test(stationId) ||
    actualFields.length !== expectedFields.length ||
    actualFields.some((field, index) => field !== expectedFields[index])
  ) {
    pairingKeyBytes.fill(0);
    throw new Error('Der QR-Code ist unvollständig oder ungültig.');
  }

  return {
    version,
    stationId,
    pairingKeyBytes,
    endpoint,
  };
}

/** Validates the authenticated one-use v2 bootstrap recovered through v3. */
export function parseDiscoveredScannerBootstrap(
  value,
  { sessionId: expectedSessionId, endpoint: expectedEndpoint },
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Die sichere Sitzung ist unvollständig oder ungültig.');
  }
  const expectedFields = ['e', 'k', 's', 'u', 'v'];
  const expectedVersionedFields = [
    ...expectedFields,
    'documentSetVersion',
  ].sort();
  const actualFields = Object.keys(value).sort();
  const fieldsMatch =
    (actualFields.length === expectedFields.length &&
      actualFields.every((field, index) => field === expectedFields[index])) ||
    (actualFields.length === expectedVersionedFields.length &&
      actualFields.every(
        (field, index) => field === expectedVersionedFields[index],
      ));
  if (
    !fieldsMatch ||
    (value.documentSetVersion !== undefined && value.documentSetVersion !== 3)
  ) {
    throw new Error('Die sichere Sitzung ist unvollständig oder ungültig.');
  }
  const parsed = parseOneUseBootstrap({
    v: value.v,
    s: value.s,
    u: value.u,
    k: value.k,
    e: value.e,
  });
  if (
    parsed.version !== '2' ||
    parsed.sessionId !== expectedSessionId ||
    parsed.endpoint !== expectedEndpoint
  ) {
    parsed.keyBytes.fill(0);
    throw new Error('Die sichere Sitzung ist unvollständig oder ungültig.');
  }
  return {
    ...parsed,
    documentSetVersion: value.documentSetVersion === 3 ? 3 : 2,
  };
}

function assertImageShape(image) {
  if (
    !Number.isInteger(image?.width) ||
    !Number.isInteger(image?.height) ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    throw new TypeError('Die Bildabmessungen sind ungültig.');
  }
  const pixelCount = image.width * image.height;
  if (
    image.data?.length !== pixelCount &&
    image.data?.length !== pixelCount * 4
  ) {
    throw new TypeError(
      'Die Bilddaten müssen Graustufen- oder RGBA-Pixel enthalten.',
    );
  }
}

function lumaAt(data, pixel, rgba) {
  if (!rgba) return Math.max(0, Math.min(255, Number(data[pixel]) || 0));
  const offset = pixel * 4;
  return Math.max(
    0,
    Math.min(
      255,
      data[offset] * 0.2126 +
        data[offset + 1] * 0.7152 +
        data[offset + 2] * 0.0722,
    ),
  );
}

function grayscaleGrid(image, maximumLongEdge = MAX_ANALYSIS_LONG_EDGE) {
  assertImageShape(image);
  const longEdge = Math.max(image.width, image.height);
  const scale = Math.min(1, maximumLongEdge / longEdge);
  const width = Math.max(3, Math.round(image.width * scale));
  const height = Math.max(3, Math.round(image.height * scale));
  const result = new Float32Array(width * height);
  const rgba = image.data.length === image.width * image.height * 4;

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(
      image.height - 1,
      Math.floor(((y + 0.5) * image.height) / height),
    );
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(
        image.width - 1,
        Math.floor(((x + 0.5) * image.width) / width),
      );
      result[y * width + x] = lumaAt(
        image.data,
        sourceY * image.width + sourceX,
        rgba,
      );
    }
  }
  return { data: result, width, height };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function rotatePoint(point, center, radians) {
  if (radians === 0) return point;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return {
    x: center.x + x * cosine - y * sine,
    y: center.y + x * sine + y * cosine,
  };
}

function perspectiveGuideQuad(guide, topInsetFraction, rollDegrees) {
  const topInset = guide.width * topInsetFraction;
  const center = {
    x: guide.x + guide.width / 2,
    y: guide.y + guide.height / 2,
  };
  const radians = (rollDegrees * Math.PI) / 180;
  return {
    topLeft: rotatePoint(
      { x: guide.x + topInset, y: guide.y },
      center,
      radians,
    ),
    topRight: rotatePoint(
      { x: guide.x + guide.width - topInset, y: guide.y },
      center,
      radians,
    ),
    bottomRight: rotatePoint(
      { x: guide.x + guide.width, y: guide.y + guide.height },
      center,
      radians,
    ),
    bottomLeft: rotatePoint(
      { x: guide.x, y: guide.y + guide.height },
      center,
      radians,
    ),
  };
}

function searchSegmentEdge(gray, start, end, normalTolerance) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length < 4) return { offset: 0, score: 0, coverage: 0 };
  const normalX = -deltaY / length;
  const normalY = deltaX / length;
  const sampleCount = Math.max(12, Math.floor(length / 2));
  const offsetStep = Math.max(1, Math.floor(normalTolerance / 18));
  let best = { offset: 0, score: 0, coverage: 0 };

  for (
    let offset = -normalTolerance;
    offset <= normalTolerance;
    offset += offsetStep
  ) {
    let energy = 0;
    let covered = 0;
    let samples = 0;
    for (let sample = 1; sample < sampleCount; sample += 1) {
      const progress = sample / sampleCount;
      const x = start.x + deltaX * progress + normalX * offset;
      const y = start.y + deltaY * progress + normalY * offset;
      const beforeX = Math.round(x - normalX * 1.5);
      const beforeY = Math.round(y - normalY * 1.5);
      const afterX = Math.round(x + normalX * 1.5);
      const afterY = Math.round(y + normalY * 1.5);
      if (
        beforeX < 0 ||
        beforeX >= gray.width ||
        afterX < 0 ||
        afterX >= gray.width ||
        beforeY < 0 ||
        beforeY >= gray.height ||
        afterY < 0 ||
        afterY >= gray.height
      ) {
        continue;
      }
      const gradient = Math.abs(
        gray.data[afterY * gray.width + afterX] -
          gray.data[beforeY * gray.width + beforeX],
      );
      energy += gradient;
      if (gradient >= 14) covered += 1;
      samples += 1;
    }
    const coverage = covered / Math.max(1, samples);
    const score = energy / Math.max(1, samples) + coverage * 18;
    if (score > best.score) best = { offset, score, coverage };
  }
  return best;
}

function normalizedRect(rect, fromWidth, fromHeight, toWidth, toHeight) {
  return {
    x: (rect.x / fromWidth) * toWidth,
    y: (rect.y / fromHeight) * toHeight,
    width: (rect.width / fromWidth) * toWidth,
    height: (rect.height / fromHeight) * toHeight,
  };
}

function interiorDetail(gray, box) {
  const left = clamp(Math.floor(box.x + box.width * 0.05), 1, gray.width - 2);
  const right = clamp(
    Math.ceil(box.x + box.width * 0.95),
    left + 1,
    gray.width - 1,
  );
  const top = clamp(Math.floor(box.y + box.height * 0.07), 1, gray.height - 2);
  const bottom = clamp(
    Math.ceil(box.y + box.height * 0.93),
    top + 1,
    gray.height - 1,
  );
  let detailed = 0;
  let samples = 0;
  for (let y = top; y < bottom; y += 3) {
    for (let x = left; x < right; x += 3) {
      const index = y * gray.width + x;
      const gradient =
        Math.abs(gray.data[index + 1] - gray.data[index - 1]) +
        Math.abs(gray.data[index + gray.width] - gray.data[index - gray.width]);
      if (gradient >= 28) detailed += 1;
      samples += 1;
    }
  }
  return detailed / Math.max(1, samples);
}

/**
 * Lightweight, deliberately tolerant document positioning. It looks for long
 * card edges close to straight and mildly perspective guide candidates.
 * Requiring only three confident edges avoids punishing rounded corners,
 * reflections, shadows and ordinary hand jitter.
 */
export function analyzeFramePosition(image, guideRect) {
  assertImageShape(image);
  if (
    !guideRect ||
    guideRect.width <= 0 ||
    guideRect.height <= 0 ||
    guideRect.x < 0 ||
    guideRect.y < 0
  ) {
    throw new TypeError('Der Ausweisrahmen ist ungültig.');
  }

  // Positioning only needs edge geometry. A compact analysis grid keeps the
  // repeated live check responsive on older applicant phones while the final
  // scan still uses the camera's full resolution.
  const gray = grayscaleGrid(image, 360);
  const guide = normalizedRect(
    guideRect,
    image.width,
    image.height,
    gray.width,
    gray.height,
  );
  const edgeIsStrong = (edge) => edge.score >= 7 && edge.coverage >= 0.06;
  // Try the visible guide and the common straight placement first. Most live
  // frames therefore finish after one or two inexpensive hypotheses. The
  // remaining bounded candidates cover pronounced perspective and up to six
  // degrees of sideways roll without blocking the phone's main UI thread.
  const perspectiveCandidates = [
    [0.06, 0],
    [0, 0],
    [0.1, 0],
    [0.14, 0],
    [-0.04, 0],
    [0.06, -6],
    [0.06, 6],
    [0, -6],
    [0, 6],
    [0.1, -6],
    [0.1, 6],
    [0.14, -6],
    [0.14, 6],
    [-0.04, -6],
    [-0.04, 6],
  ];
  let bestMatch = { strongEdges: 0, score: 0 };
  for (const [topInset, roll] of perspectiveCandidates) {
    const quad = perspectiveGuideQuad(guide, topInset, roll);
    const edges = {
      left: searchSegmentEdge(
        gray,
        quad.topLeft,
        quad.bottomLeft,
        guide.width * 0.2,
      ),
      right: searchSegmentEdge(
        gray,
        quad.topRight,
        quad.bottomRight,
        guide.width * 0.2,
      ),
      top: searchSegmentEdge(
        gray,
        quad.topLeft,
        quad.topRight,
        guide.height * 0.22,
      ),
      bottom: searchSegmentEdge(
        gray,
        quad.bottomLeft,
        quad.bottomRight,
        guide.height * 0.22,
      ),
    };
    const strongEdges = Object.values(edges).filter(edgeIsStrong).length;
    const score = Object.values(edges).reduce(
      (total, edge) => total + edge.score,
      0,
    );
    if (
      strongEdges > bestMatch.strongEdges ||
      (strongEdges === bestMatch.strongEdges && score > bestMatch.score)
    ) {
      bestMatch = { strongEdges, score };
    }
    if (strongEdges === 4) break;
  }
  const strongEdges = bestMatch.strongEdges;
  // The final photo is cropped to the visible guide, not to this lightweight
  // edge estimate. Printed lines and holograms can otherwise be mistaken for
  // a card boundary and make an already well-positioned ID appear to jump.
  // Keep the edges only as document-presence evidence and anchor the hold
  // timer to the stable guide itself.
  const detail = interiorDetail(gray, guide);
  const hasContent = detail >= 0.006;
  const positioned = strongEdges >= 3 && hasContent;

  let reason = 'Ausweis hochkant vollständig in den Rahmen halten.';
  if (strongEdges >= 3 && !hasContent)
    reason = 'Ausweis ruhig und gut beleuchtet halten.';
  else if (positioned) reason = 'Position passt. Bitte ruhig halten.';

  const resultBox = normalizedRect(
    guide,
    gray.width,
    gray.height,
    image.width,
    image.height,
  );
  gray.data.fill(0);
  return {
    positioned,
    reason,
    box: resultBox,
    strongEdges,
    detail,
  };
}

function boxMovement(previous, current, frameWidth, frameHeight) {
  if (!previous || !current) return 0;
  return Math.max(
    Math.abs(previous.x - current.x) / frameWidth,
    Math.abs(previous.y - current.y) / frameHeight,
    Math.abs(previous.width - current.width) / frameWidth,
    Math.abs(previous.height - current.height) / frameHeight,
  );
}

export function createHoldState() {
  return {
    stableSince: null,
    lastValidAt: null,
    box: null,
    holding: false,
    ready: false,
    remainingMs: HOLD_DURATION_MS,
    countdown: 3,
  };
}

/** Pure state transition used by both the live scanner and deterministic tests. */
export function updateHoldState(previous, observation, now, frameSize) {
  const reset = createHoldState();
  if (!Number.isFinite(now)) return reset;

  if (!observation?.positioned) {
    const withinGrace =
      previous?.stableSince !== null &&
      previous?.lastValidAt !== null &&
      now - previous.lastValidAt <= INVALID_GRACE_MS;
    if (!withinGrace) return reset;
    const elapsed = Math.max(0, now - previous.stableSince);
    const remainingMs = Math.max(0, HOLD_DURATION_MS - elapsed);
    return {
      ...previous,
      holding: true,
      ready: remainingMs === 0,
      remainingMs,
      countdown: remainingMs === 0 ? 0 : Math.ceil(remainingMs / 1_000),
    };
  }

  const movedTooFar =
    previous?.box &&
    boxMovement(
      previous.box,
      observation.box,
      frameSize.width,
      frameSize.height,
    ) > MAX_STABLE_MOVEMENT;
  const stableSince =
    previous?.stableSince === null || movedTooFar
      ? now
      : Math.min(now, previous.stableSince);
  const elapsed = Math.max(0, now - stableSince);
  const remainingMs = Math.max(0, HOLD_DURATION_MS - elapsed);
  return {
    stableSince,
    lastValidAt: now,
    box: observation.box,
    holding: true,
    ready: remainingMs === 0,
    remainingMs,
    countdown: remainingMs === 0 ? 0 : Math.ceil(remainingMs / 1_000),
  };
}

function calculateQualityMetrics(image, grayscale) {
  const insetX = Math.max(1, Math.floor(grayscale.width * 0.02));
  const insetY = Math.max(1, Math.floor(grayscale.height * 0.02));
  const tileColumns = 12;
  const tileRows = 8;
  const tileSamples = new Uint32Array(tileColumns * tileRows);
  const tileClippedLight = new Uint32Array(tileColumns * tileRows);
  let samples = 0;
  let sum = 0;
  let squareSum = 0;
  let clippedDark = 0;
  let clippedLight = 0;

  for (let y = insetY; y < grayscale.height - insetY; y += 1) {
    for (let x = insetX; x < grayscale.width - insetX; x += 1) {
      const value = grayscale.data[y * grayscale.width + x];
      sum += value;
      squareSum += value * value;
      if (value <= 12) clippedDark += 1;
      if (value >= 250) clippedLight += 1;
      samples += 1;
      const tileX = Math.min(
        tileColumns - 1,
        Math.floor((x * tileColumns) / grayscale.width),
      );
      const tileY = Math.min(
        tileRows - 1,
        Math.floor((y * tileRows) / grayscale.height),
      );
      const tileIndex = tileY * tileColumns + tileX;
      tileSamples[tileIndex] += 1;
      if (value >= 250) tileClippedLight[tileIndex] += 1;
    }
  }

  const brightness = samples > 0 ? sum / samples : 0;
  const variance =
    samples > 0 ? squareSum / samples - brightness * brightness : 0;
  const contrast = Math.sqrt(Math.max(0, variance));
  let laplaceSamples = 0;
  let laplaceSum = 0;
  let laplaceSquareSum = 0;
  for (let y = 1; y < grayscale.height - 1; y += 1) {
    for (let x = 1; x < grayscale.width - 1; x += 1) {
      const index = y * grayscale.width + x;
      const laplace =
        grayscale.data[index - 1] +
        grayscale.data[index + 1] +
        grayscale.data[index - grayscale.width] +
        grayscale.data[index + grayscale.width] -
        grayscale.data[index] * 4;
      laplaceSum += laplace;
      laplaceSquareSum += laplace * laplace;
      laplaceSamples += 1;
    }
  }
  const laplaceMean = laplaceSamples > 0 ? laplaceSum / laplaceSamples : 0;
  const laplaceVariance =
    laplaceSamples > 0
      ? laplaceSquareSum / laplaceSamples - laplaceMean * laplaceMean
      : 0;
  let glare = 0;
  for (let index = 0; index < tileSamples.length; index += 1) {
    if (tileSamples[index] === 0) continue;
    glare = Math.max(glare, tileClippedLight[index] / tileSamples[index]);
  }
  return {
    width: image.width,
    height: image.height,
    longEdge: Math.max(image.width, image.height),
    shortEdge: Math.min(image.width, image.height),
    brightness,
    contrast,
    sharpness: Math.sqrt(Math.max(0, laplaceVariance)),
    clippedDark: samples > 0 ? clippedDark / samples : 1,
    clippedLight: samples > 0 ? clippedLight / samples : 1,
    glare,
  };
}

function qualityResult(status, message, metrics) {
  return { accepted: status === 'accepted', status, message, metrics };
}

/** Mirrors lib/mobile-id-capture-quality.ts for browser-side early rejection. */
export function analyzeCaptureQuality(
  image,
  {
    minimumLongEdge = CAPTURE_MIN_LONG_EDGE,
    minimumShortEdge = CAPTURE_MIN_SHORT_EDGE,
    minimumSharpness = MIN_LAPLACIAN_SHARPNESS,
  } = {},
) {
  assertImageShape(image);
  const grayscale = grayscaleGrid(image);
  const metrics = calculateQualityMetrics(image, grayscale);
  grayscale.data.fill(0);
  if (
    metrics.longEdge < minimumLongEdge ||
    metrics.shortEdge < minimumShortEdge
  ) {
    return qualityResult(
      'resolution',
      'Die Aufnahme ist zu klein. Bitte den Ausweis etwas näher aufnehmen.',
      metrics,
    );
  }
  if (metrics.brightness < MIN_BRIGHTNESS) {
    return qualityResult(
      'lighting',
      'Die Aufnahme ist zu dunkel. Bitte gleichmäßiger beleuchten.',
      metrics,
    );
  }
  if (metrics.brightness > MAX_BRIGHTNESS) {
    return qualityResult(
      'lighting',
      'Die Aufnahme ist zu hell. Bitte direkte Beleuchtung vermeiden.',
      metrics,
    );
  }
  if (metrics.clippedDark > MAX_CLIPPED_DARK) {
    return qualityResult(
      'lighting',
      'Zu viele Bereiche sind schwarz. Bitte die Beleuchtung ändern.',
      metrics,
    );
  }
  if (
    metrics.clippedLight > MAX_CLIPPED_LIGHT ||
    (metrics.clippedLight > MIN_GLOBAL_GLARE_SUPPORT &&
      metrics.glare > MAX_GLARE_TILE)
  ) {
    return qualityResult(
      'glare',
      'Starke Spiegelung erkannt. Bitte den Winkel leicht ändern.',
      metrics,
    );
  }
  if (metrics.contrast < MIN_CONTRAST) {
    return qualityResult(
      'contrast',
      'Der Kontrast ist zu gering. Bitte Licht oder Untergrund ändern.',
      metrics,
    );
  }
  if (metrics.sharpness < minimumSharpness) {
    return qualityResult(
      'sharpness',
      'Die Aufnahme ist unscharf. Bitte ruhig halten und fokussieren.',
      metrics,
    );
  }
  return qualityResult(
    'accepted',
    'Technische Qualitätsprüfung bestanden.',
    metrics,
  );
}

/**
 * A restrained scan-like tone adjustment. It only changes existing pixel
 * values; it performs no OCR, generative fill or reconstruction of text.
 */
export function enhanceScanPixels(image) {
  assertImageShape(image);
  if (image.data.length !== image.width * image.height * 4) {
    throw new TypeError('Die Scan-Optimierung benötigt RGBA-Pixel.');
  }
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const red = image.data[offset];
    const green = image.data[offset + 1];
    const blue = image.data[offset + 2];
    const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    for (let channel = 0; channel < 3; channel += 1) {
      const original = image.data[offset + channel];
      const softlyDesaturated = luma + (original - luma) * 0.94;
      image.data[offset + channel] = clamp(
        Math.round(128 + (softlyDesaturated - 128) * 1.06),
        0,
        255,
      );
    }
  }
  return image;
}

export function coverSourceRect(
  sourceWidth,
  sourceHeight,
  viewWidth,
  viewHeight,
) {
  if (
    ![sourceWidth, sourceHeight, viewWidth, viewHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    throw new TypeError('Die Kameraabmessungen sind ungültig.');
  }
  const sourceRatio = sourceWidth / sourceHeight;
  const viewRatio = viewWidth / viewHeight;
  if (sourceRatio > viewRatio) {
    const width = sourceHeight * viewRatio;
    return { x: (sourceWidth - width) / 2, y: 0, width, height: sourceHeight };
  }
  const height = sourceWidth / viewRatio;
  return { x: 0, y: (sourceHeight - height) / 2, width: sourceWidth, height };
}

/** Maps the fixed on-screen guide to the exact pixels visible behind it. */
export function guideCropInSource(
  guideRect,
  sourceWidth,
  sourceHeight,
  viewWidth,
  viewHeight,
) {
  if (
    !guideRect ||
    ![guideRect.x, guideRect.y, guideRect.width, guideRect.height].every(
      Number.isFinite,
    ) ||
    guideRect.width <= 0 ||
    guideRect.height <= 0
  ) {
    throw new TypeError('Der Scanrahmen ist ungültig.');
  }
  const sourceCrop = coverSourceRect(
    sourceWidth,
    sourceHeight,
    viewWidth,
    viewHeight,
  );
  return {
    x: sourceCrop.x + (guideRect.x / viewWidth) * sourceCrop.width,
    y: sourceCrop.y + (guideRect.y / viewHeight) * sourceCrop.height,
    width: (guideRect.width / viewWidth) * sourceCrop.width,
    height: (guideRect.height / viewHeight) * sourceCrop.height,
  };
}

/** Expands rather than shrinks so detected card edges are never cut away. */
export function normalizedIdCrop(
  box,
  frameWidth,
  frameHeight,
  margin = 0.018,
  orientation = 'landscape',
  landscapeAspectRatio = ID_CARD_ASPECT_RATIO,
) {
  if (orientation !== 'landscape' && orientation !== 'portrait') {
    throw new TypeError('Die Ausweisausrichtung ist ungültig.');
  }
  if (!Number.isFinite(landscapeAspectRatio) || landscapeAspectRatio <= 1) {
    throw new TypeError('Das Dokumentenformat ist ungültig.');
  }
  const targetAspect =
    orientation === 'portrait'
      ? 1 / landscapeAspectRatio
      : landscapeAspectRatio;
  let width = box.width * (1 + margin * 2);
  let height = box.height * (1 + margin * 2);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  if (width / height > targetAspect) height = width / targetAspect;
  else width = height * targetAspect;
  const fitScale = Math.min(1, frameWidth / width, frameHeight / height);
  width *= fitScale;
  height *= fitScale;
  const x = clamp(centerX - width / 2, 0, frameWidth - width);
  const y = clamp(centerY - height / 2, 0, frameHeight - height);
  return { x, y, width, height };
}

export function portraitCaptureLayout(
  crop,
  maximumLongEdge = 2_400,
  landscapeAspectRatio = ID_CARD_ASPECT_RATIO,
) {
  if (
    !crop ||
    !Number.isFinite(crop.width) ||
    !Number.isFinite(crop.height) ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    !Number.isFinite(maximumLongEdge) ||
    maximumLongEdge <= 0 ||
    !Number.isFinite(landscapeAspectRatio) ||
    landscapeAspectRatio <= 1
  ) {
    throw new TypeError('Der Hochkant-Ausschnitt ist ungültig.');
  }
  const width = Math.max(1, Math.floor(Math.min(maximumLongEdge, crop.height)));
  const height = Math.max(1, Math.floor(width / landscapeAspectRatio));
  return { width, height, clockwise: false };
}

export function drawPortraitCropAsLandscape(
  context,
  source,
  crop,
  outputWidth,
  outputHeight,
) {
  context.save();
  context.translate(0, outputHeight);
  context.rotate(-Math.PI / 2);
  context.drawImage(
    source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    outputHeight,
    outputWidth,
  );
  context.restore();
}
