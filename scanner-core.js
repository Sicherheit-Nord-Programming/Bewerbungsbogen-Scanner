export const ID_CARD_ASPECT_RATIO = 85.6 / 53.98;
export const ID_CARD_PORTRAIT_ASPECT_RATIO = 1 / ID_CARD_ASPECT_RATIO;
export const PASSPORT_ASPECT_RATIO = 125 / 88;
export const ID_CARD_GUIDE_VIEWBOX = Object.freeze({
  x: 0,
  y: 0,
  width: 100,
  height: 63,
});
export const ID_CARD_GUIDE_QUAD = Object.freeze({
  topLeft: Object.freeze({ x: 14, y: 7 }),
  topRight: Object.freeze({ x: 86, y: 11 }),
  bottomRight: Object.freeze({ x: 98, y: 59 }),
  bottomLeft: Object.freeze({ x: 2, y: 55 }),
});
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

const QUAD_POINT_NAMES = Object.freeze([
  'topLeft',
  'topRight',
  'bottomRight',
  'bottomLeft',
]);

function assertRect(rect, message) {
  if (
    !rect ||
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    throw new TypeError(message);
  }
}

function assertQuad(quad, message = 'Das Scanviereck ist ungültig.') {
  if (
    !quad ||
    QUAD_POINT_NAMES.some(
      (name) =>
        !quad[name] ||
        !Number.isFinite(quad[name].x) ||
        !Number.isFinite(quad[name].y),
    )
  ) {
    throw new TypeError(message);
  }

  const points = QUAD_POINT_NAMES.map((name) => quad[name]);
  let winding = 0;
  for (let index = 0; index < points.length; index += 1) {
    const first = points[index];
    const second = points[(index + 1) % points.length];
    const third = points[(index + 2) % points.length];
    const cross =
      (second.x - first.x) * (third.y - second.y) -
      (second.y - first.y) * (third.x - second.x);
    if (Math.abs(cross) <= 1e-8) throw new TypeError(message);
    const currentWinding = Math.sign(cross);
    if (winding !== 0 && currentWinding !== winding) {
      throw new TypeError(message);
    }
    winding = currentWinding;
  }
  return quad;
}

function mapQuad(quad, mapPoint) {
  return Object.fromEntries(
    QUAD_POINT_NAMES.map((name) => [name, mapPoint(quad[name])]),
  );
}

function quadBounds(quad) {
  const points = QUAD_POINT_NAMES.map((name) => quad[name]);
  const left = Math.min(...points.map(({ x }) => x));
  const right = Math.max(...points.map(({ x }) => x));
  const top = Math.min(...points.map(({ y }) => y));
  const bottom = Math.max(...points.map(({ y }) => y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Maps SVG/view-box guide points into the guide element's pixel rectangle. */
export function guideQuadInRect(
  guideRect,
  guideQuad = ID_CARD_GUIDE_QUAD,
  guideViewBox = ID_CARD_GUIDE_VIEWBOX,
) {
  assertRect(guideRect, 'Der Scanrahmen ist ungültig.');
  assertRect(guideViewBox, 'Die Ansichtsbox des Scanrahmens ist ungültig.');
  assertQuad(guideQuad);
  return mapQuad(guideQuad, (point) => ({
    x:
      guideRect.x +
      ((point.x - guideViewBox.x) / guideViewBox.width) * guideRect.width,
    y:
      guideRect.y +
      ((point.y - guideViewBox.y) / guideViewBox.height) * guideRect.height,
  }));
}

function projectiveMapForQuad(quad) {
  assertQuad(quad);
  const { topLeft, topRight, bottomRight, bottomLeft } = quad;
  const deltaX1 = topRight.x - bottomRight.x;
  const deltaX2 = bottomLeft.x - bottomRight.x;
  const deltaX3 = topLeft.x - topRight.x + bottomRight.x - bottomLeft.x;
  const deltaY1 = topRight.y - bottomRight.y;
  const deltaY2 = bottomLeft.y - bottomRight.y;
  const deltaY3 = topLeft.y - topRight.y + bottomRight.y - bottomLeft.y;

  let perspectiveX = 0;
  let perspectiveY = 0;
  if (Math.abs(deltaX3) > 1e-10 || Math.abs(deltaY3) > 1e-10) {
    const determinant = deltaX1 * deltaY2 - deltaX2 * deltaY1;
    if (Math.abs(determinant) <= 1e-10) {
      throw new TypeError('Das Scanviereck kann nicht entzerrt werden.');
    }
    perspectiveX = (deltaX3 * deltaY2 - deltaX2 * deltaY3) / determinant;
    perspectiveY = (deltaX1 * deltaY3 - deltaX3 * deltaY1) / determinant;
  }

  return {
    xx: topRight.x - topLeft.x + perspectiveX * topRight.x,
    xy: bottomLeft.x - topLeft.x + perspectiveY * bottomLeft.x,
    x0: topLeft.x,
    yx: topRight.y - topLeft.y + perspectiveX * topRight.y,
    yy: bottomLeft.y - topLeft.y + perspectiveY * bottomLeft.y,
    y0: topLeft.y,
    perspectiveX,
    perspectiveY,
  };
}

function mapProjectivePoint(projectiveMap, horizontal, vertical) {
  const denominator =
    projectiveMap.perspectiveX * horizontal +
    projectiveMap.perspectiveY * vertical +
    1;
  if (Math.abs(denominator) <= 1e-10) {
    throw new TypeError('Das Scanviereck kann nicht entzerrt werden.');
  }
  return {
    x:
      (projectiveMap.xx * horizontal +
        projectiveMap.xy * vertical +
        projectiveMap.x0) /
      denominator,
    y:
      (projectiveMap.yx * horizontal +
        projectiveMap.yy * vertical +
        projectiveMap.y0) /
      denominator,
  };
}

/** Returns the source point at a normalized position inside a perspective quad. */
export function projectPointInQuad(quad, horizontal, vertical) {
  if (
    !Number.isFinite(horizontal) ||
    !Number.isFinite(vertical) ||
    horizontal < 0 ||
    horizontal > 1 ||
    vertical < 0 ||
    vertical > 1
  ) {
    throw new TypeError('Die Position im Scanviereck ist ungültig.');
  }
  return mapProjectivePoint(projectiveMapForQuad(quad), horizontal, vertical);
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
  let best = {
    offset: 0,
    score: 0,
    coverage: 0,
    longestRunCoverage: 0,
    signedContrast: 0,
    polarityAgreement: 0,
  };
  const candidates = [];

  for (
    let offset = -normalTolerance;
    offset <= normalTolerance;
    offset += offsetStep
  ) {
    let energy = 0;
    let covered = 0;
    let samples = 0;
    let signedEnergy = 0;
    let positive = 0;
    let negative = 0;
    let currentRun = 0;
    let longestRun = 0;
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
      const signedGradient =
        gray.data[afterY * gray.width + afterX] -
        gray.data[beforeY * gray.width + beforeX];
      const gradient = Math.abs(signedGradient);
      energy += gradient;
      signedEnergy += signedGradient;
      if (gradient >= 14) {
        covered += 1;
        currentRun += 1;
        longestRun = Math.max(longestRun, currentRun);
        if (signedGradient >= 0) positive += 1;
        else negative += 1;
      } else {
        currentRun = 0;
      }
      samples += 1;
    }
    const coverage = covered / Math.max(1, samples);
    const score = energy / Math.max(1, samples) + coverage * 18;
    const candidate = {
      offset,
      score,
      coverage,
      longestRunCoverage: longestRun / Math.max(1, samples),
      signedContrast: signedEnergy / Math.max(1, samples),
      polarityAgreement:
        covered > 0 ? Math.max(positive, negative) / covered : 0,
    };
    candidates.push(candidate);
    if (score > best.score) best = candidate;
  }
  const runnerUp = candidates
    .filter(
      (candidate) =>
        Math.abs(candidate.offset - best.offset) >
        Math.max(2, normalTolerance * 0.08),
    )
    .reduce((highest, candidate) => Math.max(highest, candidate.score), 0);
  return {
    ...best,
    peakMargin: best.score - runnerUp,
    peakDominance: best.score / Math.max(1, runnerUp),
  };
}

function shiftedLine(start, end, offset) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.hypot(deltaX, deltaY);
  const normalX = -deltaY / length;
  const normalY = deltaX / length;
  return {
    start: {
      x: start.x + normalX * offset,
      y: start.y + normalY * offset,
    },
    end: {
      x: end.x + normalX * offset,
      y: end.y + normalY * offset,
    },
  };
}

function lineIntersection(first, second) {
  const firstX = first.end.x - first.start.x;
  const firstY = first.end.y - first.start.y;
  const secondX = second.end.x - second.start.x;
  const secondY = second.end.y - second.start.y;
  const determinant = firstX * secondY - firstY * secondX;
  if (Math.abs(determinant) <= 1e-8) return null;
  const relativeX = second.start.x - first.start.x;
  const relativeY = second.start.y - first.start.y;
  const progress = (relativeX * secondY - relativeY * secondX) / determinant;
  return {
    x: first.start.x + progress * firstX,
    y: first.start.y + progress * firstY,
  };
}

function detectedQuadFromEdges(guideQuad, edges) {
  const lines = {
    left: shiftedLine(
      guideQuad.topLeft,
      guideQuad.bottomLeft,
      edges.left.offset,
    ),
    right: shiftedLine(
      guideQuad.topRight,
      guideQuad.bottomRight,
      edges.right.offset,
    ),
    top: shiftedLine(guideQuad.topLeft, guideQuad.topRight, edges.top.offset),
    bottom: shiftedLine(
      guideQuad.bottomLeft,
      guideQuad.bottomRight,
      edges.bottom.offset,
    ),
  };
  const quad = {
    topLeft: lineIntersection(lines.top, lines.left),
    topRight: lineIntersection(lines.top, lines.right),
    bottomRight: lineIntersection(lines.bottom, lines.right),
    bottomLeft: lineIntersection(lines.bottom, lines.left),
  };
  if (Object.values(quad).some((point) => !point)) return null;
  try {
    assertQuad(quad);
  } catch {
    return null;
  }
  return quad;
}

function sampledDocumentRegion(gray, box, quad = null) {
  const bounds = quad ? quadBounds(quad) : box;
  const aspectRatio = bounds.width / bounds.height;
  const maximumEdge = 140;
  const width = Math.max(
    48,
    Math.round(aspectRatio >= 1 ? maximumEdge : maximumEdge * aspectRatio),
  );
  const height = Math.max(
    48,
    Math.round(aspectRatio >= 1 ? maximumEdge / aspectRatio : maximumEdge),
  );
  const values = new Float32Array(width * height);
  const projectiveMap = quad ? projectiveMapForQuad(quad) : null;
  for (let row = 0; row < height; row += 1) {
    const vertical = 0.045 + ((row + 0.5) / height) * 0.91;
    for (let column = 0; column < width; column += 1) {
      const horizontal = 0.04 + ((column + 0.5) / width) * 0.92;
      const point = projectiveMap
        ? mapProjectivePoint(projectiveMap, horizontal, vertical)
        : {
            x: box.x + box.width * horizontal,
            y: box.y + box.height * vertical,
          };
      const x = clamp(Math.round(point.x), 0, gray.width - 1);
      const y = clamp(Math.round(point.y), 0, gray.height - 1);
      values[row * width + column] = gray.data[y * gray.width + x];
    }
  }
  return { data: values, width, height };
}

function projectionRegularity(values) {
  if (values.length < 7)
    return {
      regular: false,
      peaks: 0,
      spacingCv: 1,
      periodicCorrelation: 0,
      period: 0,
    };
  const mean =
    values.reduce((total, value) => total + value, 0) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    values.length;
  const threshold = mean + Math.sqrt(variance) * 0.8;
  const candidates = [];
  for (let index = 1; index < values.length - 1; index += 1) {
    if (
      values[index] >= threshold &&
      values[index] >= values[index - 1] &&
      values[index] >= values[index + 1]
    ) {
      const previous = candidates.at(-1);
      if (previous !== undefined && index - previous < 3) {
        if (values[index] > values[previous])
          candidates[candidates.length - 1] = index;
      } else {
        candidates.push(index);
      }
    }
  }
  const spacings = candidates
    .slice(1)
    .map((value, index) => value - candidates[index]);
  const spacingMean =
    spacings.length > 0
      ? spacings.reduce((total, value) => total + value, 0) / spacings.length
      : 0;
  const spacingVariance =
    spacings.length > 0
      ? spacings.reduce(
          (total, value) => total + (value - spacingMean) ** 2,
          0,
        ) / spacings.length
      : 0;
  const spacingCv =
    spacings.length > 0
      ? Math.sqrt(spacingVariance) / Math.max(1, spacingMean)
      : 1;
  let periodicCorrelation = 0;
  let period = 0;
  for (let lag = 3; lag <= Math.floor(values.length / 4); lag += 1) {
    let numerator = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = 0; index < values.length - lag; index += 1) {
      const left = values[index] - mean;
      const right = values[index + lag] - mean;
      numerator += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const correlation =
      numerator / Math.max(1e-6, Math.sqrt(leftEnergy * rightEnergy));
    if (correlation > periodicCorrelation) {
      periodicCorrelation = correlation;
      period = lag;
    }
  }
  return {
    regular:
      (candidates.length >= 5 && spacingCv <= 0.3) ||
      periodicCorrelation >= 0.42,
    peaks: candidates.length,
    spacingCv,
    periodicCorrelation,
    period,
  };
}

function documentTextureMetrics(gray, box, quad, slot = 'generic') {
  const sample = sampledDocumentRegion(gray, box, quad);
  const { data, width, height } = sample;
  const sorted = Array.from(data).sort((left, right) => left - right);
  const percentile = (fraction) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
  const p10 = percentile(0.1);
  const p75 = percentile(0.75);
  const p90 = percentile(0.9);
  const brightness =
    data.reduce((total, value) => total + value, 0) / data.length;

  const stride = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowTotal = 0;
    for (let x = 0; x < width; x += 1) {
      rowTotal += data[y * width + x];
      integral[(y + 1) * stride + x + 1] =
        integral[y * stride + x + 1] + rowTotal;
    }
  }

  const strokes = new Uint8Array(width * height);
  let strokePixels = 0;
  const radius = 4;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height - 1, y + radius);
      const area = (right - left + 1) * (bottom - top + 1);
      const sum =
        integral[(bottom + 1) * stride + right + 1] -
        integral[top * stride + right + 1] -
        integral[(bottom + 1) * stride + left] +
        integral[top * stride + left];
      const localMean = sum / area;
      const index = y * width + x;
      if (localMean - data[index] >= 12 && data[index] <= p75 - 6) {
        strokes[index] = 1;
        strokePixels += 1;
      }
    }
  }

  const components = [];
  const queue = new Int32Array(strokes.length);
  for (let start = 0; start < strokes.length; start += 1) {
    if (strokes[start] === 0) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    strokes[start] = 0;
    let area = 0;
    let minimumX = width;
    let maximumX = 0;
    let minimumY = height;
    let maximumY = 0;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      area += 1;
      minimumX = Math.min(minimumX, x);
      maximumX = Math.max(maximumX, x);
      minimumY = Math.min(minimumY, y);
      maximumY = Math.max(maximumY, y);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height)
            continue;
          const next = nextY * width + nextX;
          if (strokes[next] === 0) continue;
          strokes[next] = 0;
          queue[tail++] = next;
        }
      }
    }
    const componentWidth = maximumX - minimumX + 1;
    const componentHeight = maximumY - minimumY + 1;
    const fill = area / (componentWidth * componentHeight);
    if (
      area >= 2 &&
      area <= data.length * 0.0045 &&
      componentWidth <= width * 0.18 &&
      componentHeight <= height * 0.14 &&
      fill >= 0.08 &&
      fill <= 1
    ) {
      components.push({
        area,
        centerX: (minimumX + maximumX) / 2,
        centerY: (minimumY + maximumY) / 2,
      });
    }
  }

  // Every supported identity document carries text in its center/right area.
  // Ignoring the far-left photo zone prevents portrait texture from being
  // mistaken for one continuous text block.
  const textComponents = components.filter(
    (component) => component.centerX >= width * 0.25,
  );
  const rowHits = new Uint16Array(height);
  const occupiedTiles = new Set();
  for (const component of textComponents) {
    rowHits[clamp(Math.round(component.centerY), 0, height - 1)] += 1;
    occupiedTiles.add(
      `${Math.min(5, Math.floor((component.centerX / width) * 6))}:${Math.min(
        3,
        Math.floor((component.centerY / height) * 4),
      )}`,
    );
  }
  let textBands = 0;
  let bandStart = -1;
  let bandComponents = 0;
  const maximumBandHeight = Math.max(5, Math.ceil(height * 0.18));
  for (let y = 0; y <= height; y += 1) {
    const hits =
      y < height
        ? rowHits[y] + (rowHits[y - 1] || 0) + (rowHits[y + 1] || 0)
        : 0;
    if (hits >= 3) {
      if (bandStart < 0) {
        bandStart = y;
        bandComponents = 0;
      }
      bandComponents += rowHits[y] || 0;
    } else if (bandStart >= 0) {
      const bandHeight = y - bandStart;
      if (bandComponents >= 3 && bandHeight <= maximumBandHeight)
        textBands += 1;
      bandStart = -1;
      bandComponents = 0;
    }
  }

  const verticalProjection = new Float32Array(width);
  const horizontalProjection = new Float32Array(height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      verticalProjection[x] += Math.abs(data[index + 1] - data[index - 1]);
      horizontalProjection[y] += Math.abs(
        data[index + width] - data[index - width],
      );
    }
  }
  for (let x = 0; x < width; x += 1)
    verticalProjection[x] /= Math.max(1, height - 2);
  for (let y = 0; y < height; y += 1)
    horizontalProjection[y] /= Math.max(1, width - 2);
  const verticalRegularity = projectionRegularity(verticalProjection);
  const horizontalRegularity = projectionRegularity(horizontalProjection);
  const edgeDensity = strokePixels / data.length;
  const twoAxisGridLike =
    edgeDensity >= 0.02 &&
    verticalRegularity.regular &&
    horizontalRegularity.regular;
  // Real laptop keyboards are not perfect grids: their rows are staggered and
  // the space bar destroys vertical periodicity. They still produce an
  // unusually dense field of small edges, several evenly repeating rows and
  // many vertical peaks. Requiring that combination avoids treating ordinary
  // document text lines as keys merely because one projection is periodic.
  const staggeredKeyGridLike =
    edgeDensity >= 0.2 &&
    horizontalRegularity.regular &&
    horizontalRegularity.periodicCorrelation >= 0.48 &&
    verticalRegularity.peaks >= 8 &&
    textComponents.length >= 24 &&
    textBands >= 4 &&
    occupiedTiles.size >= 8;
  const gridLike = twoAxisGridLike || staggeredKeyGridLike;
  const minimumComponents = slot === 'passport-data' ? 10 : 8;
  const accepted =
    brightness >= 52 &&
    p75 >= 72 &&
    p90 - p10 >= 14 &&
    edgeDensity >= 0.006 &&
    edgeDensity <= 0.38 &&
    textComponents.length >= minimumComponents &&
    textBands >= 2 &&
    occupiedTiles.size >= 3 &&
    !gridLike;
  sample.data.fill(0);
  return {
    accepted,
    brightness,
    tonalRange: p90 - p10,
    edgeDensity,
    textComponents: textComponents.length,
    textBands,
    occupiedTiles: occupiedTiles.size,
    gridLike,
    staggeredKeyGridLike,
    verticalRegularity,
    horizontalRegularity,
  };
}

export function analyzeDocumentPresence(
  image,
  { regionRect = null, regionQuad = null, slot = 'generic' } = {},
) {
  assertImageShape(image);
  const fullRect = { x: 0, y: 0, width: image.width, height: image.height };
  const rect = regionRect || (regionQuad ? quadBounds(regionQuad) : fullRect);
  assertRect(rect, 'Der Dokumentbereich ist ungültig.');
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > image.width ||
    rect.y + rect.height > image.height
  ) {
    throw new TypeError('Der Dokumentbereich ist ungültig.');
  }
  if (regionQuad) assertQuad(regionQuad, 'Der Dokumentbereich ist ungültig.');
  const gray = grayscaleGrid(image, 360);
  const normalizedRegion = normalizedRect(
    rect,
    image.width,
    image.height,
    gray.width,
    gray.height,
  );
  const normalizedRegionQuad = regionQuad
    ? normalizedQuad(
        regionQuad,
        image.width,
        image.height,
        gray.width,
        gray.height,
      )
    : null;
  const metrics = documentTextureMetrics(
    gray,
    normalizedRegion,
    normalizedRegionQuad,
    slot,
  );
  gray.data.fill(0);
  return {
    accepted: metrics.accepted,
    status: metrics.accepted ? 'accepted' : 'document',
    message: metrics.accepted
      ? 'Dokument erkannt.'
      : 'Kein Dokument erkannt. Bitte nur den Ausweis oder Pass in den Rahmen halten.',
    metrics,
  };
}

function normalizedRect(rect, fromWidth, fromHeight, toWidth, toHeight) {
  return {
    x: (rect.x / fromWidth) * toWidth,
    y: (rect.y / fromHeight) * toHeight,
    width: (rect.width / fromWidth) * toWidth,
    height: (rect.height / fromHeight) * toHeight,
  };
}

function normalizedQuad(quad, fromWidth, fromHeight, toWidth, toHeight) {
  return mapQuad(quad, (point) => ({
    x: (point.x / fromWidth) * toWidth,
    y: (point.y / fromHeight) * toHeight,
  }));
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

function interiorDetailInQuad(gray, quad) {
  const bounds = quadBounds(quad);
  const horizontalSamples = Math.max(12, Math.floor(bounds.width / 3));
  const verticalSamples = Math.max(8, Math.floor(bounds.height / 3));
  const projectiveMap = projectiveMapForQuad(quad);
  let detailed = 0;
  let samples = 0;
  for (let row = 1; row < verticalSamples; row += 1) {
    const vertical = 0.07 + (row / verticalSamples) * 0.86;
    for (let column = 1; column < horizontalSamples; column += 1) {
      const horizontal = 0.05 + (column / horizontalSamples) * 0.9;
      const point = mapProjectivePoint(projectiveMap, horizontal, vertical);
      const x = clamp(Math.round(point.x), 1, gray.width - 2);
      const y = clamp(Math.round(point.y), 1, gray.height - 2);
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
 * Lightweight document positioning. The strict mode used by the camera
 * requires one coherent printed-document surface; the legacy default keeps
 * this helper backwards compatible for callers that only need edge placement.
 */
export function analyzeFramePosition(
  image,
  guideRect,
  exactGuideQuad = null,
  { requireDocumentPresence = false, slot = 'generic' } = {},
) {
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
  if (exactGuideQuad) {
    assertQuad(exactGuideQuad, 'Das Scanviereck ist ungültig.');
    const bounds = quadBounds(exactGuideQuad);
    if (
      bounds.x < 0 ||
      bounds.y < 0 ||
      bounds.x + bounds.width > image.width ||
      bounds.y + bounds.height > image.height
    ) {
      throw new TypeError('Das Scanviereck ist ungültig.');
    }
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
  const normalizedExactQuad = exactGuideQuad
    ? normalizedQuad(
        exactGuideQuad,
        image.width,
        image.height,
        gray.width,
        gray.height,
      )
    : null;
  const edgeIsStrong = (edge) => edge.score >= 7 && edge.coverage >= 0.06;
  const edgeLooksLikeBoundary = (edge) =>
    edgeIsStrong(edge) &&
    edge.longestRunCoverage >= 0.16 &&
    edge.polarityAgreement >= 0.58;
  // Try the visible guide and the common straight placement first. Most live
  // frames therefore finish after one or two inexpensive hypotheses. The
  // remaining bounded candidates cover pronounced perspective and up to six
  // degrees of sideways roll without blocking the phone's main UI thread.
  const perspectiveCandidates = normalizedExactQuad
    ? [normalizedExactQuad]
    : [
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
  let bestMatch = {
    strongEdges: 0,
    documentEdges: 0,
    uniqueEdges: 0,
    consistentPolarity: 0,
    score: 0,
    quad: normalizedExactQuad || perspectiveGuideQuad(guide, 0.06, 0),
    detectedQuad: null,
    edges: null,
  };
  for (const candidate of perspectiveCandidates) {
    const quad = normalizedExactQuad
      ? candidate
      : perspectiveGuideQuad(guide, candidate[0], candidate[1]);
    const edges = {
      left: searchSegmentEdge(
        gray,
        quad.topLeft,
        quad.bottomLeft,
        guide.width * (requireDocumentPresence ? 0.12 : 0.2),
      ),
      right: searchSegmentEdge(
        gray,
        quad.topRight,
        quad.bottomRight,
        guide.width * (requireDocumentPresence ? 0.12 : 0.2),
      ),
      top: searchSegmentEdge(
        gray,
        quad.topLeft,
        quad.topRight,
        guide.height * (requireDocumentPresence ? 0.14 : 0.22),
      ),
      bottom: searchSegmentEdge(
        gray,
        quad.bottomLeft,
        quad.bottomRight,
        guide.height * (requireDocumentPresence ? 0.14 : 0.22),
      ),
    };
    const strongEdges = Object.values(edges).filter(edgeIsStrong).length;
    const documentEdges = Object.values(edges).filter(
      edgeLooksLikeBoundary,
    ).length;
    const uniqueEdges = Object.values(edges).filter(
      (edge) =>
        edgeLooksLikeBoundary(edge) &&
        (edge.peakMargin >= 1.3 || edge.peakDominance >= 1.04),
    ).length;
    const normalizedOutsideContrast = {
      left: edges.left.signedContrast,
      right: -edges.right.signedContrast,
      top: -edges.top.signedContrast,
      bottom: edges.bottom.signedContrast,
    };
    const boundaryContrasts = Object.entries(normalizedOutsideContrast)
      .filter(
        ([name, contrast]) =>
          edgeLooksLikeBoundary(edges[name]) && Math.abs(contrast) >= 3,
      )
      .map(([, contrast]) => contrast);
    const positivePolarity = boundaryContrasts.filter(
      (contrast) => contrast > 0,
    ).length;
    const negativePolarity = boundaryContrasts.filter(
      (contrast) => contrast < 0,
    ).length;
    const consistentPolarity = Math.max(positivePolarity, negativePolarity);
    const detectedQuad = detectedQuadFromEdges(quad, edges);
    const score = Object.values(edges).reduce(
      (total, edge) => total + edge.score,
      0,
    );
    if (
      documentEdges > bestMatch.documentEdges ||
      (documentEdges === bestMatch.documentEdges &&
        consistentPolarity > bestMatch.consistentPolarity) ||
      (documentEdges === bestMatch.documentEdges &&
        consistentPolarity === bestMatch.consistentPolarity &&
        uniqueEdges > bestMatch.uniqueEdges) ||
      (documentEdges === bestMatch.documentEdges &&
        consistentPolarity === bestMatch.consistentPolarity &&
        uniqueEdges === bestMatch.uniqueEdges &&
        strongEdges > bestMatch.strongEdges) ||
      (documentEdges === bestMatch.documentEdges &&
        consistentPolarity === bestMatch.consistentPolarity &&
        uniqueEdges === bestMatch.uniqueEdges &&
        strongEdges === bestMatch.strongEdges &&
        score > bestMatch.score)
    ) {
      bestMatch = {
        strongEdges,
        documentEdges,
        uniqueEdges,
        consistentPolarity,
        score,
        quad,
        detectedQuad,
        edges,
      };
    }
    if (documentEdges === 4 && uniqueEdges >= 3 && consistentPolarity >= 3)
      break;
  }
  const strongEdges = bestMatch.strongEdges;
  const detectedBounds = bestMatch.detectedQuad
    ? quadBounds(bestMatch.detectedQuad)
    : guide;
  const detectedCenter = {
    x: detectedBounds.x + detectedBounds.width / 2,
    y: detectedBounds.y + detectedBounds.height / 2,
  };
  const guideCenter = {
    x: guide.x + guide.width / 2,
    y: guide.y + guide.height / 2,
  };
  const geometryCoherent =
    Boolean(bestMatch.detectedQuad) &&
    detectedBounds.width / guide.width >= 0.72 &&
    detectedBounds.width / guide.width <= 1.28 &&
    detectedBounds.height / guide.height >= 0.72 &&
    detectedBounds.height / guide.height <= 1.28 &&
    Math.abs(detectedCenter.x - guideCenter.x) <= guide.width * 0.15 &&
    Math.abs(detectedCenter.y - guideCenter.y) <= guide.height * 0.17;
  const detail = normalizedExactQuad
    ? interiorDetailInQuad(gray, normalizedExactQuad)
    : interiorDetail(gray, guide);
  const hasContent = detail >= 0.006;
  const texture = requireDocumentPresence
    ? documentTextureMetrics(gray, detectedBounds, bestMatch.detectedQuad, slot)
    : null;
  const boundaryAccepted =
    geometryCoherent &&
    bestMatch.documentEdges >= 3 &&
    bestMatch.uniqueEdges >= 2 &&
    bestMatch.consistentPolarity >= 2;
  const documentPresent = requireDocumentPresence
    ? Boolean(texture?.accepted)
    : hasContent;
  const positioned = requireDocumentPresence
    ? boundaryAccepted && documentPresent
    : strongEdges >= 3 && hasContent;

  let reason = 'Ausweis vollständig in den Rahmen halten.';
  if (requireDocumentPresence && boundaryAccepted && !texture?.accepted)
    reason =
      'Kein Dokument erkannt. Bitte nur den Ausweis oder Pass in den Rahmen halten.';
  else if (strongEdges >= 3 && !hasContent)
    reason = 'Ausweis ruhig und gut beleuchtet halten.';
  else if (positioned)
    reason = 'Dokument erkannt. Position passt. Bitte ruhig halten.';

  const resultBounds =
    requireDocumentPresence && bestMatch.detectedQuad ? detectedBounds : guide;
  const resultBox = normalizedRect(
    resultBounds,
    gray.width,
    gray.height,
    image.width,
    image.height,
  );
  const resultQuad =
    requireDocumentPresence && bestMatch.detectedQuad
      ? normalizedQuad(
          bestMatch.detectedQuad,
          gray.width,
          gray.height,
          image.width,
          image.height,
        )
      : exactGuideQuad
        ? mapQuad(exactGuideQuad, (point) => ({ ...point }))
        : null;
  gray.data.fill(0);
  return {
    positioned,
    documentPresent,
    reason,
    box: resultBox,
    quad: resultQuad,
    strongEdges,
    documentEdges: bestMatch.documentEdges,
    uniqueEdges: bestMatch.uniqueEdges,
    consistentPolarity: bestMatch.consistentPolarity,
    geometryCoherent,
    detail,
    texture,
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

/** Maps every visible guide corner to the corresponding camera-source pixel. */
export function guideQuadInSource(
  guideQuad,
  sourceWidth,
  sourceHeight,
  viewWidth,
  viewHeight,
) {
  assertQuad(guideQuad);
  const bounds = quadBounds(guideQuad);
  if (
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.x + bounds.width > viewWidth ||
    bounds.y + bounds.height > viewHeight
  ) {
    throw new TypeError('Das Scanviereck liegt außerhalb des Kamerabilds.');
  }
  const sourceCrop = coverSourceRect(
    sourceWidth,
    sourceHeight,
    viewWidth,
    viewHeight,
  );
  return mapQuad(guideQuad, (point) => ({
    x: sourceCrop.x + (point.x / viewWidth) * sourceCrop.width,
    y: sourceCrop.y + (point.y / viewHeight) * sourceCrop.height,
  }));
}

function positiveInteger(value, fallback, message) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isInteger(candidate) || candidate <= 0 || candidate > 64) {
    throw new TypeError(message);
  }
  return candidate;
}

/**
 * Builds a triangle mesh that maps a perspective source quadrilateral onto a
 * flat output rectangle. Keeping this part pure makes browser drawing easy to
 * test without a DOM or camera.
 */
export function perspectiveRectificationMesh(
  sourceQuad,
  outputWidth,
  outputHeight,
  options = {},
) {
  assertQuad(sourceQuad);
  if (
    !Number.isFinite(outputWidth) ||
    !Number.isFinite(outputHeight) ||
    outputWidth <= 0 ||
    outputHeight <= 0
  ) {
    throw new TypeError('Die Ausgabeabmessungen sind ungültig.');
  }
  const columns = positiveInteger(
    options.columns,
    12,
    'Die Spaltenzahl der Entzerrung ist ungültig.',
  );
  const rows = positiveInteger(
    options.rows,
    Math.max(1, Math.round((columns * outputHeight) / outputWidth)),
    'Die Zeilenzahl der Entzerrung ist ungültig.',
  );
  const projectiveMap = projectiveMapForQuad(sourceQuad);
  const triangles = [];
  for (let row = 0; row < rows; row += 1) {
    const verticalStart = row / rows;
    const verticalEnd = (row + 1) / rows;
    const outputTop = verticalStart * outputHeight;
    const outputBottom = verticalEnd * outputHeight;
    for (let column = 0; column < columns; column += 1) {
      const horizontalStart = column / columns;
      const horizontalEnd = (column + 1) / columns;
      const outputLeft = horizontalStart * outputWidth;
      const outputRight = horizontalEnd * outputWidth;
      const sourceTopLeft = mapProjectivePoint(
        projectiveMap,
        horizontalStart,
        verticalStart,
      );
      const sourceTopRight = mapProjectivePoint(
        projectiveMap,
        horizontalEnd,
        verticalStart,
      );
      const sourceBottomRight = mapProjectivePoint(
        projectiveMap,
        horizontalEnd,
        verticalEnd,
      );
      const sourceBottomLeft = mapProjectivePoint(
        projectiveMap,
        horizontalStart,
        verticalEnd,
      );
      const outputTopLeft = { x: outputLeft, y: outputTop };
      const outputTopRight = { x: outputRight, y: outputTop };
      const outputBottomRight = { x: outputRight, y: outputBottom };
      const outputBottomLeft = { x: outputLeft, y: outputBottom };
      triangles.push(
        {
          source: [sourceTopLeft, sourceTopRight, sourceBottomRight],
          destination: [outputTopLeft, outputTopRight, outputBottomRight],
        },
        {
          source: [sourceTopLeft, sourceBottomRight, sourceBottomLeft],
          destination: [outputTopLeft, outputBottomRight, outputBottomLeft],
        },
      );
    }
  }
  return { columns, rows, triangles };
}

function affineTransformBetweenTriangles(source, destination) {
  const [first, second, third] = source;
  const [mappedFirst, mappedSecond, mappedThird] = destination;
  const determinant =
    first.x * (second.y - third.y) +
    second.x * (third.y - first.y) +
    third.x * (first.y - second.y);
  if (Math.abs(determinant) <= 1e-10) {
    throw new TypeError('Das Scanviereck kann nicht entzerrt werden.');
  }
  const coefficients = (firstValue, secondValue, thirdValue) => ({
    x:
      (firstValue * (second.y - third.y) +
        secondValue * (third.y - first.y) +
        thirdValue * (first.y - second.y)) /
      determinant,
    y:
      (firstValue * (third.x - second.x) +
        secondValue * (first.x - third.x) +
        thirdValue * (second.x - first.x)) /
      determinant,
    offset:
      (firstValue * (second.x * third.y - third.x * second.y) +
        secondValue * (third.x * first.y - first.x * third.y) +
        thirdValue * (first.x * second.y - second.x * first.y)) /
      determinant,
  });
  const horizontal = coefficients(mappedFirst.x, mappedSecond.x, mappedThird.x);
  const vertical = coefficients(mappedFirst.y, mappedSecond.y, mappedThird.y);
  return [
    horizontal.x,
    vertical.x,
    horizontal.y,
    vertical.y,
    horizontal.offset,
    vertical.offset,
  ];
}

/**
 * Rectifies a perspective quadrilateral with the standard Canvas 2D API.
 * The destination context should belong to an output canvas of the requested
 * dimensions. A future portrait capture can continue to use the dedicated
 * rectangular helper instead.
 */
export function drawPerspectiveQuadAsRectangle(
  context,
  source,
  sourceQuad,
  outputWidth,
  outputHeight,
  options = {},
) {
  const requiredMethods = [
    'save',
    'restore',
    'beginPath',
    'moveTo',
    'lineTo',
    'closePath',
    'clip',
    'transform',
    'drawImage',
  ];
  if (
    !context ||
    !source ||
    requiredMethods.some((method) => typeof context[method] !== 'function')
  ) {
    throw new TypeError('Der Zeichenkontext für die Entzerrung ist ungültig.');
  }
  const mesh = perspectiveRectificationMesh(
    sourceQuad,
    outputWidth,
    outputHeight,
    options,
  );
  for (const triangle of mesh.triangles) {
    context.save();
    context.beginPath();
    context.moveTo(triangle.destination[0].x, triangle.destination[0].y);
    context.lineTo(triangle.destination[1].x, triangle.destination[1].y);
    context.lineTo(triangle.destination[2].x, triangle.destination[2].y);
    context.closePath();
    context.clip();
    context.transform(
      ...affineTransformBetweenTriangles(triangle.source, triangle.destination),
    );
    context.drawImage(source, 0, 0);
    context.restore();
  }
  return {
    columns: mesh.columns,
    rows: mesh.rows,
    triangleCount: mesh.triangles.length,
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
