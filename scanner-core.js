export const ID_CARD_ASPECT_RATIO = 85.6 / 53.98;
export const ID_CARD_PORTRAIT_ASPECT_RATIO = 1 / ID_CARD_ASPECT_RATIO;
export const HOLD_DURATION_MS = 3_000;
export const INVALID_GRACE_MS = 350;
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
const APPS_SCRIPT_ENDPOINT_PATTERN = /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

function base64urlToBytes(value) {
  const base64 =
    value.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/**
 * Parses the one-use QR fragment without ever placing its secrets in a query
 * string. The endpoint is deliberately restricted to the production Apps
 * Script host so a forged QR code cannot redirect encrypted ID material.
 */
export function parseScannerBootstrap(hash) {
  const fragment = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const version = fragment.get('v') || '';
  const sessionId = fragment.get('s') || '';
  const uploadCapability = fragment.get('u') || '';
  const encodedKey = fragment.get('k') || '';
  const endpointValue = fragment.get('e') || '';

  let endpoint;
  let keyBytes;
  try {
    endpoint = new URL(endpointValue);
    keyBytes = base64urlToBytes(encodedKey);
  } catch {
    throw new Error('Der QR-Code ist unvollständig oder ungültig.');
  }

  if (
    version !== '1' ||
    !SESSION_PATTERN.test(sessionId) ||
    !CAPABILITY_PATTERN.test(uploadCapability) ||
    !CAPABILITY_PATTERN.test(encodedKey) ||
    keyBytes.length !== 32 ||
    endpoint.protocol !== 'https:' ||
    endpoint.hostname !== 'script.google.com' ||
    endpoint.search ||
    endpoint.hash ||
    !APPS_SCRIPT_ENDPOINT_PATTERN.test(endpoint.pathname)
  ) {
    keyBytes.fill(0);
    throw new Error('Der QR-Code ist unvollständig oder ungültig.');
  }

  return {
    version,
    sessionId,
    uploadCapability,
    keyBytes,
    endpoint: endpoint.href,
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

function searchVerticalEdge(gray, expectedX, tolerance, top, bottom) {
  const start = clamp(Math.floor(expectedX - tolerance), 2, gray.width - 3);
  const end = clamp(Math.ceil(expectedX + tolerance), 2, gray.width - 3);
  const yStart = clamp(Math.floor(top), 1, gray.height - 2);
  const yEnd = clamp(Math.ceil(bottom), yStart + 1, gray.height - 1);
  let best = { position: expectedX, score: 0, coverage: 0 };

  for (let x = start; x <= end; x += 1) {
    let energy = 0;
    let covered = 0;
    let samples = 0;
    for (let y = yStart; y < yEnd; y += 2) {
      const index = y * gray.width + x;
      const gradient = Math.abs(gray.data[index + 1] - gray.data[index - 1]);
      energy += gradient;
      if (gradient >= 14) covered += 1;
      samples += 1;
    }
    const coverage = covered / Math.max(1, samples);
    const score = energy / Math.max(1, samples) + coverage * 18;
    if (score > best.score) best = { position: x, score, coverage };
  }
  return best;
}

function searchHorizontalEdge(gray, expectedY, tolerance, left, right) {
  const start = clamp(Math.floor(expectedY - tolerance), 2, gray.height - 3);
  const end = clamp(Math.ceil(expectedY + tolerance), 2, gray.height - 3);
  const xStart = clamp(Math.floor(left), 1, gray.width - 2);
  const xEnd = clamp(Math.ceil(right), xStart + 1, gray.width - 1);
  let best = { position: expectedY, score: 0, coverage: 0 };

  for (let y = start; y <= end; y += 1) {
    let energy = 0;
    let covered = 0;
    let samples = 0;
    for (let x = xStart; x < xEnd; x += 2) {
      const index = y * gray.width + x;
      const gradient = Math.abs(
        gray.data[index + gray.width] - gray.data[index - gray.width],
      );
      energy += gradient;
      if (gradient >= 14) covered += 1;
      samples += 1;
    }
    const coverage = covered / Math.max(1, samples);
    const score = energy / Math.max(1, samples) + coverage * 18;
    if (score > best.score) best = { position: y, score, coverage };
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
 * card edges close to the visual ID-1 guide. Requiring only three confident
 * edges avoids punishing rounded corners, shadows and ordinary hand jitter.
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

  const gray = grayscaleGrid(image, 480);
  const guide = normalizedRect(
    guideRect,
    image.width,
    image.height,
    gray.width,
    gray.height,
  );
  const verticalTolerance = guide.width * 0.16;
  const horizontalTolerance = guide.height * 0.19;
  const verticalTop = guide.y + guide.height * 0.17;
  const verticalBottom = guide.y + guide.height * 0.83;
  const horizontalLeft = guide.x + guide.width * 0.14;
  const horizontalRight = guide.x + guide.width * 0.86;

  const edges = {
    left: searchVerticalEdge(
      gray,
      guide.x,
      verticalTolerance,
      verticalTop,
      verticalBottom,
    ),
    right: searchVerticalEdge(
      gray,
      guide.x + guide.width,
      verticalTolerance,
      verticalTop,
      verticalBottom,
    ),
    top: searchHorizontalEdge(
      gray,
      guide.y,
      horizontalTolerance,
      horizontalLeft,
      horizontalRight,
    ),
    bottom: searchHorizontalEdge(
      gray,
      guide.y + guide.height,
      horizontalTolerance,
      horizontalLeft,
      horizontalRight,
    ),
  };

  const edgeIsStrong = (edge) => edge.score >= 8.5 && edge.coverage >= 0.08;
  const strongEdges = Object.values(edges).filter(edgeIsStrong).length;
  const left = edgeIsStrong(edges.left) ? edges.left.position : guide.x;
  const right = edgeIsStrong(edges.right)
    ? edges.right.position
    : guide.x + guide.width;
  const top = edgeIsStrong(edges.top) ? edges.top.position : guide.y;
  const bottom = edgeIsStrong(edges.bottom)
    ? edges.bottom.position
    : guide.y + guide.height;
  const box = {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };

  const widthScale = box.width / guide.width;
  const heightScale = box.height / guide.height;
  const ratio = box.width / box.height;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const guideCenterX = guide.x + guide.width / 2;
  const guideCenterY = guide.y + guide.height / 2;
  const centered =
    Math.abs(centerX - guideCenterX) <= guide.width * 0.11 &&
    Math.abs(centerY - guideCenterY) <= guide.height * 0.14;
  const sized =
    widthScale >= 0.74 &&
    widthScale <= 1.16 &&
    heightScale >= 0.72 &&
    heightScale <= 1.2;
  const portraitGuide = guide.height > guide.width;
  const ratioFits = portraitGuide
    ? ratio >= 1 / 1.78 && ratio <= 1 / 1.4
    : ratio >= 1.4 && ratio <= 1.78;
  const detail = interiorDetail(gray, box);
  const hasContent = detail >= 0.012;
  const positioned =
    strongEdges >= 3 && centered && sized && ratioFits && hasContent;

  let reason = 'Ausweis hochkant vollständig in den Rahmen halten.';
  if (strongEdges >= 3 && !sized)
    reason =
      widthScale < 0.74 || heightScale < 0.72
        ? 'Näher herangehen.'
        : 'Etwas mehr Abstand halten.';
  else if (strongEdges >= 3 && !centered)
    reason = 'Ausweis mittig in den Rahmen bewegen.';
  else if (strongEdges >= 3 && !ratioFits)
    reason = 'Ausweis gerade und vollständig ausrichten.';
  else if (strongEdges >= 3 && !hasContent)
    reason = 'Ausweis ruhig und gut beleuchtet halten.';
  else if (positioned) reason = 'Position passt. Bitte ruhig halten.';

  const resultBox = normalizedRect(
    box,
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

/** Expands rather than shrinks so detected card edges are never cut away. */
export function normalizedIdCrop(
  box,
  frameWidth,
  frameHeight,
  margin = 0.018,
  orientation = 'landscape',
) {
  if (orientation !== 'landscape' && orientation !== 'portrait') {
    throw new TypeError('Die Ausweisausrichtung ist ungültig.');
  }
  const targetAspect =
    orientation === 'portrait'
      ? ID_CARD_PORTRAIT_ASPECT_RATIO
      : ID_CARD_ASPECT_RATIO;
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

export function portraitCaptureLayout(crop, maximumLongEdge = 2_400) {
  if (
    !crop ||
    !Number.isFinite(crop.width) ||
    !Number.isFinite(crop.height) ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    !Number.isFinite(maximumLongEdge) ||
    maximumLongEdge <= 0
  ) {
    throw new TypeError('Der Hochkant-Ausschnitt ist ungültig.');
  }
  const width = Math.max(
    1,
    Math.floor(Math.min(maximumLongEdge, crop.height)),
  );
  const height = Math.max(1, Math.floor(width / ID_CARD_ASPECT_RATIO));
  return { width, height, clockwise: true };
}

export function drawPortraitCropAsLandscape(
  context,
  source,
  crop,
  outputWidth,
  outputHeight,
) {
  context.save();
  context.translate(outputWidth, 0);
  context.rotate(Math.PI / 2);
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

export function preferredCameraZoom(zoomCapability) {
  const minimum = Number(zoomCapability?.min);
  const maximum = Number(zoomCapability?.max);
  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    minimum <= 0 ||
    maximum < minimum
  ) {
    return null;
  }
  return Math.max(minimum, Math.min(1, maximum));
}
