import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';

import {
  analyzeCaptureQuality,
  analyzeDocumentPresence,
  analyzeFramePosition,
  canCompleteDocumentSession,
  coverSourceRect,
  createHoldState,
  documentScanStatus,
  drawPerspectiveQuadAsRectangle,
  drawPortraitCropAsLandscape,
  enhanceScanPixels,
  guideCropInSource,
  guideQuadInRect,
  guideQuadInSource,
  ID_CARD_ASPECT_RATIO,
  ID_CARD_GUIDE_QUAD,
  ID_CARD_GUIDE_VIEWBOX,
  ID_CARD_PORTRAIT_ASPECT_RATIO,
  isPlausibleTaxId,
  nextDocumentSlot,
  nextSelectedPlanStep,
  normalizedIdCrop,
  parseDiscoveredScannerBootstrap,
  parseScannerBootstrap,
  PASSPORT_ASPECT_RATIO,
  PRODUCTION_ID_CAPTURE_RELAY_ENDPOINT,
  perspectiveRectificationMesh,
  portraitCaptureLayout,
  projectPointInQuad,
  SCANNER_DOCUMENTS,
  scannerDocumentsForVersion,
  selectedDocumentPlanComplete,
  normalizeTaxId,
  updateHoldState,
} from './scanner-core.js';

function qrFragment(overrides = {}) {
  const values = {
    v: '1',
    s: '11111111-1111-4111-8111-111111111111',
    u: 'A'.repeat(43),
    k: 'B'.repeat(43),
    e: 'https://script.google.com/macros/s/AKfycbx_TEST-123/exec',
    ...overrides,
  };
  return `#${new URLSearchParams(values)}`;
}

function staticQrFragment(overrides = {}) {
  const values = {
    v: '3',
    d: 'a'.repeat(64),
    p: 'C'.repeat(43),
    e: 'https://script.google.com/macros/s/AKfycbx_TEST-123/exec',
    ...overrides,
  };
  return `#${new URLSearchParams(values)}`;
}

function frameFixture({
  width = 480,
  height = 640,
  card = { x: 35, y: 201, width: 410, height: 259 },
  backgroundValue = 34,
  cardValue = 210,
  textValue = 64,
} = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside =
        x >= card.x &&
        x < card.x + card.width &&
        y >= card.y &&
        y < card.y + card.height;
      const text =
        inside &&
        y > card.y + 30 &&
        y < card.y + card.height - 25 &&
        ((y - card.y) % 31 < 4 ||
          ((x - card.x) % 47 < 4 && x < card.x + card.width * 0.63));
      const value = text ? textValue : inside ? cardValue : backgroundValue;
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

function plausibleDocumentFixture({
  width = 480,
  height = 640,
  card = { x: 35, y: 201, width: 410, height: 259 },
  backgroundValue = 35,
  cardValue = 205,
  textValue = 48,
} = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  const setPixel = (x, y, value) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = (y * width + x) * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside =
        x >= card.x &&
        x < card.x + card.width &&
        y >= card.y &&
        y < card.y + card.height;
      setPixel(x, y, inside ? cardValue : backgroundValue);
    }
  }

  const portrait = {
    x: Math.round(card.x + card.width * 0.07),
    y: Math.round(card.y + card.height * 0.17),
    width: Math.round(card.width * 0.23),
    height: Math.round(card.height * 0.62),
  };
  for (let y = portrait.y; y < portrait.y + portrait.height; y += 1) {
    for (let x = portrait.x; x < portrait.x + portrait.width; x += 1) {
      const tone = 92 + ((x * 7 + y * 5) % 46);
      setPixel(x, y, tone);
    }
  }

  const glyphWidth = Math.max(5, Math.round(card.width * 0.013));
  const glyphHeight = Math.max(9, Math.round(card.height * 0.038));
  const lineStartX = Math.round(card.x + card.width * 0.38);
  const lineFractions = [0.13, 0.235, 0.37, 0.515, 0.655, 0.805];
  for (let line = 0; line < lineFractions.length; line += 1) {
    const y = Math.round(card.y + card.height * lineFractions[line]);
    const glyphs = 6 + (line % 4);
    let x = lineStartX + (line % 2) * glyphWidth;
    for (let glyph = 0; glyph < glyphs; glyph += 1) {
      const widthVariation = glyph % 3 === 0 ? 2 : 0;
      for (let py = y; py < y + glyphHeight; py += 1) {
        for (let px = x; px < x + glyphWidth + widthVariation; px += 1) {
          setPixel(px, py, textValue);
        }
      }
      x += Math.round(card.width * (glyph % 3 === 1 ? 0.066 : 0.049));
    }
  }
  return { data, width, height };
}

function keyboardFixture({
  width = 480,
  height = 640,
  keyboard = { x: 35, y: 201, width: 410, height: 259 },
  light = false,
} = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  const background = light ? 158 : 32;
  const base = light ? 218 : 58;
  const key = light ? 238 : 102;
  const label = light ? 58 : 232;
  const setPixel = (x, y, value) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = (y * width + x) * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) setPixel(x, y, background);
  }
  for (let y = keyboard.y; y < keyboard.y + keyboard.height; y += 1) {
    for (let x = keyboard.x; x < keyboard.x + keyboard.width; x += 1)
      setPixel(x, y, base);
  }
  const columns = 10;
  const rows = 5;
  const gap = Math.max(4, Math.round(keyboard.width * 0.012));
  const keyWidth = Math.floor((keyboard.width - gap * (columns + 1)) / columns);
  const keyHeight = Math.floor((keyboard.height - gap * (rows + 1)) / rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = keyboard.x + gap + column * (keyWidth + gap);
      const y = keyboard.y + gap + row * (keyHeight + gap);
      for (let py = y; py < y + keyHeight; py += 1) {
        for (let px = x; px < x + keyWidth; px += 1) setPixel(px, py, key);
      }
      const labelX = x + Math.floor(keyWidth * 0.42);
      const labelY = y + Math.floor(keyHeight * 0.36);
      for (let py = labelY; py < labelY + Math.max(3, keyHeight / 5); py += 1) {
        for (let px = labelX; px < labelX + Math.max(2, keyWidth / 7); px += 1)
          setPixel(px, py, label);
      }
    }
  }
  return { data, width, height };
}

function staggeredKeyboardFixture({
  width = 480,
  height = 640,
  keyboard = { x: 35, y: 201, width: 410, height: 259 },
  light = true,
} = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  const background = light ? 145 : 32;
  const base = light ? 205 : 58;
  const key = light ? 236 : 102;
  const label = light ? 50 : 232;
  const setPixel = (x, y, value) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = (y * width + x) * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  };
  const drawKey = (x, y, keyWidth, keyHeight) => {
    for (let py = y; py < y + keyHeight; py += 1) {
      for (let px = x; px < x + keyWidth; px += 1) setPixel(px, py, key);
    }
    const labelX = x + Math.floor(keyWidth * 0.42);
    const labelY = y + Math.floor(keyHeight * 0.35);
    for (let py = labelY; py < labelY + 8; py += 1) {
      for (let px = labelX; px < labelX + 4; px += 1) setPixel(px, py, label);
    }
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) setPixel(x, y, background);
  }
  for (let y = keyboard.y; y < keyboard.y + keyboard.height; y += 1) {
    for (let x = keyboard.x; x < keyboard.x + keyboard.width; x += 1)
      setPixel(x, y, base);
  }

  const rows = [
    { keys: 12, inset: 3 },
    { keys: 11, inset: 10 },
    { keys: 10, inset: 18 },
    { keys: 9, inset: 26 },
  ];
  const gap = 5;
  const keyHeight = 39;
  for (let row = 0; row < rows.length; row += 1) {
    const specification = rows[row];
    const y = keyboard.y + 8 + row * (keyHeight + 10);
    let x = keyboard.x + specification.inset;
    const keyWidth = Math.floor(
      (keyboard.width -
        specification.inset * 2 -
        gap * (specification.keys - 1)) /
        specification.keys,
    );
    for (let column = 0; column < specification.keys; column += 1) {
      drawKey(x, y, keyWidth, keyHeight);
      x += keyWidth + gap;
    }
  }

  const bottomY = keyboard.y + 8 + 4 * (keyHeight + 10);
  for (const [xOffset, keyWidth] of [
    [18, 34],
    [58, 34],
    [98, 180],
    [284, 45],
    [335, 38],
  ]) {
    drawKey(
      keyboard.x + xOffset,
      bottomY,
      keyWidth,
      Math.min(keyHeight, keyboard.y + keyboard.height - 6 - bottomY),
    );
  }
  return { data, width, height };
}

function perspectiveFrameFixture({
  width = 480,
  height = 640,
  guide = { x: 110, y: 65, width: 260, height: 412 },
  topInsetFraction = 0.08,
  rollDegrees = 0,
  backgroundValue = 34,
  cardValue = 210,
  textValue = 64,
  noiseAmplitude = 0,
} = {}) {
  const center = {
    x: guide.x + guide.width / 2,
    y: guide.y + guide.height / 2,
  };
  const radians = (rollDegrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const rotate = ({ x, y }) => {
    const relativeX = x - center.x;
    const relativeY = y - center.y;
    return {
      x: center.x + relativeX * cosine - relativeY * sine,
      y: center.y + relativeX * sine + relativeY * cosine,
    };
  };
  const inset = guide.width * topInsetFraction;
  const quad = [
    rotate({ x: guide.x + inset, y: guide.y }),
    rotate({ x: guide.x + guide.width - inset, y: guide.y }),
    rotate({ x: guide.x + guide.width, y: guide.y + guide.height }),
    rotate({ x: guide.x, y: guide.y + guide.height }),
  ];
  let noiseSeed = 0x45d9f3b;
  const insideQuad = (x, y) => {
    let sign = 0;
    for (let index = 0; index < quad.length; index += 1) {
      const start = quad[index];
      const end = quad[(index + 1) % quad.length];
      const cross =
        (end.x - start.x) * (y - start.y) - (end.y - start.y) * (x - start.x);
      if (Math.abs(cross) < 0.01) continue;
      const currentSign = Math.sign(cross);
      if (sign === 0) sign = currentSign;
      else if (currentSign !== sign) return false;
    }
    return true;
  };
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = insideQuad(x + 0.5, y + 0.5);
      const text =
        inside &&
        y > guide.y + 30 &&
        y < guide.y + guide.height - 25 &&
        ((y - guide.y) % 31 < 4 ||
          ((x - guide.x) % 47 < 4 && x < guide.x + guide.width * 0.63));
      const baseValue = text ? textValue : inside ? cardValue : backgroundValue;
      noiseSeed = (Math.imul(noiseSeed, 1_664_525) + 1_013_904_223) >>> 0;
      const noise =
        noiseAmplitude > 0
          ? ((noiseSeed >>> 24) / 255) * noiseAmplitude * 2 - noiseAmplitude
          : 0;
      const value = Math.max(0, Math.min(255, Math.round(baseValue + noise)));
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

function quadrilateralFrameFixture({
  width = 480,
  height = 640,
  quad,
  backgroundValue = 34,
  cardValue = 210,
  textValue = 64,
} = {}) {
  const points = [
    quad.topLeft,
    quad.topRight,
    quad.bottomRight,
    quad.bottomLeft,
  ];
  const bounds = {
    x: Math.min(...points.map(({ x }) => x)),
    y: Math.min(...points.map(({ y }) => y)),
    right: Math.max(...points.map(({ x }) => x)),
    bottom: Math.max(...points.map(({ y }) => y)),
  };
  const insideQuad = (x, y) => {
    let sign = 0;
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index];
      const end = points[(index + 1) % points.length];
      const cross =
        (end.x - start.x) * (y - start.y) - (end.y - start.y) * (x - start.x);
      if (Math.abs(cross) < 0.01) continue;
      const currentSign = Math.sign(cross);
      if (sign === 0) sign = currentSign;
      else if (currentSign !== sign) return false;
    }
    return true;
  };
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = insideQuad(x + 0.5, y + 0.5);
      const text =
        inside &&
        y > bounds.y + 24 &&
        y < bounds.bottom - 20 &&
        ((y - Math.floor(bounds.y)) % 27 < 4 ||
          ((x - Math.floor(bounds.x)) % 43 < 4 &&
            x < bounds.x + (bounds.right - bounds.x) * 0.66));
      const value = text ? textValue : inside ? cardValue : backgroundValue;
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

function assertPointClose(actual, expected, epsilon = 1e-8) {
  assert.ok(
    Math.abs(actual.x - expected.x) <= epsilon,
    `${actual.x} != ${expected.x}`,
  );
  assert.ok(
    Math.abs(actual.y - expected.y) <= epsilon,
    `${actual.y} != ${expected.y}`,
  );
}

function sharpCapture(width = 1_400, height = 900) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const dark = y % 73 >= 48 && y % 73 <= 54;
      const stroke = x % 53 >= 8 && x % 53 <= 13;
      const value = dark || stroke ? 62 : 211;
      data[offset] = value;
      data[offset + 1] = value + 7;
      data[offset + 2] = value - 5;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

test('parses one-use and exact static QR fragments only for the fixed Apps Script endpoint', () => {
  const parsed = parseScannerBootstrap(qrFragment());
  assert.equal(parsed.version, '1');
  assert.equal(parsed.sessionId, '11111111-1111-4111-8111-111111111111');
  assert.equal(parsed.uploadCapability, 'A'.repeat(43));
  assert.equal(parsed.keyBytes.length, 32);
  assert.equal(
    parsed.endpoint,
    'https://script.google.com/macros/s/AKfycbx_TEST-123/exec',
  );
  parsed.keyBytes.fill(0);

  const versionTwo = parseScannerBootstrap(qrFragment({ v: '2' }));
  assert.equal(versionTwo.version, '2');
  versionTwo.keyBytes.fill(0);

  const versionThree = parseScannerBootstrap(staticQrFragment());
  assert.equal(versionThree.version, '3');
  assert.equal(versionThree.stationId, 'a'.repeat(64));
  assert.equal(versionThree.pairingKeyBytes.length, 32);
  assert.equal(
    versionThree.endpoint,
    'https://script.google.com/macros/s/AKfycbx_TEST-123/exec',
  );
  versionThree.pairingKeyBytes.fill(0);

  const compactCode = Buffer.alloc(16, 0x5a);
  const compactFragment = compactCode.toString('base64url');
  const versionFour = parseScannerBootstrap(compactFragment);
  assert.equal(versionFour.version, '4');
  assert.deepEqual(Buffer.from(versionFour.compactCodeBytes), compactCode);
  assert.equal(versionFour.endpoint, PRODUCTION_ID_CAPTURE_RELAY_ENDPOINT);
  versionFour.compactCodeBytes.fill(0);

  assert.throws(
    () => parseScannerBootstrap(qrFragment({ v: '4' })),
    /ungültig/,
  );
  assert.throws(
    () => parseScannerBootstrap(`${compactFragment}&v=4`),
    /ungültig/,
  );
  assert.throws(
    () => parseScannerBootstrap(compactFragment.slice(0, -1)),
    /ungültig/,
  );
  assert.throws(
    () => parseScannerBootstrap(staticQrFragment({ d: 'a'.repeat(63) })),
    /ungültig/,
  );
  assert.throws(
    () => parseScannerBootstrap(`${staticQrFragment()}&s=unexpected`),
    /ungültig/,
  );
  assert.throws(
    () =>
      parseScannerBootstrap(qrFragment({ e: 'https://example.com/collect' })),
    /unvollständig oder ungültig/,
  );
  assert.throws(
    () =>
      parseScannerBootstrap(
        qrFragment({ e: 'https://script.google.com/macros/s/x/exec?leak=1' }),
      ),
    /unvollständig oder ungültig/,
  );
});

test('validates the decrypted static bootstrap as the discovered v2 session', () => {
  const endpoint = 'https://script.google.com/macros/s/AKfycbx_TEST-123/exec';
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const payload = {
    v: '2',
    s: sessionId,
    u: 'A'.repeat(43),
    k: 'B'.repeat(43),
    e: endpoint,
  };
  const parsed = parseDiscoveredScannerBootstrap(payload, {
    sessionId,
    endpoint,
  });
  assert.equal(parsed.version, '2');
  assert.equal(parsed.sessionId, sessionId);
  assert.equal(parsed.uploadCapability, 'A'.repeat(43));
  assert.equal(parsed.keyBytes.length, 32);
  assert.equal(parsed.documentSetVersion, 2);
  parsed.keyBytes.fill(0);

  const versioned = parseDiscoveredScannerBootstrap(
    { ...payload, documentSetVersion: 3 },
    { sessionId, endpoint },
  );
  assert.equal(versioned.documentSetVersion, 3);
  versioned.keyBytes.fill(0);

  assert.throws(
    () =>
      parseDiscoveredScannerBootstrap(
        { ...payload, documentSetVersion: 4 },
        { sessionId, endpoint },
      ),
    /ungültig/,
  );

  assert.throws(
    () =>
      parseDiscoveredScannerBootstrap(
        { ...payload, s: '22222222-2222-4222-8222-222222222222' },
        { sessionId, endpoint },
      ),
    /ungültig/,
  );
  assert.throws(
    () =>
      parseDiscoveredScannerBootstrap(
        { ...payload, extra: 'not-allowed' },
        { sessionId, endpoint },
      ),
    /ungültig/,
  );
  assert.throws(
    () =>
      parseDiscoveredScannerBootstrap(payload, {
        sessionId,
        endpoint: 'https://script.google.com/macros/s/AKfycbx_DIFFERENT/exec',
      }),
    /ungültig/,
  );
});

test('document dashboard status requires complete documents and rejects half-finished ones', () => {
  const identityCard = SCANNER_DOCUMENTS.find(
    (documentDefinition) => documentDefinition.id === 'identity-card',
  );
  const passport = SCANNER_DOCUMENTS.find(
    (documentDefinition) => documentDefinition.id === 'passport',
  );
  const healthCard = SCANNER_DOCUMENTS.find(
    (documentDefinition) => documentDefinition.id === 'health-card',
  );
  const taxId = SCANNER_DOCUMENTS.find(
    (documentDefinition) => documentDefinition.id === 'tax-id',
  );
  assert.equal(documentScanStatus(identityCard, []), 'open');
  assert.equal(documentScanStatus(identityCard, ['id-front']), 'in-progress');
  assert.equal(
    documentScanStatus(identityCard, ['id-front', 'id-back']),
    'complete',
  );
  assert.equal(documentScanStatus(passport, ['id-front', 'id-back']), 'open');
  assert.equal(documentScanStatus(healthCard, ['id-front', 'id-back']), 'open');
  assert.equal(documentScanStatus(taxId, []), 'open');
  assert.equal(documentScanStatus(taxId, ['tax-id']), 'complete');
  assert.equal(nextDocumentSlot(identityCard, []), 'id-front');
  assert.equal(nextDocumentSlot(identityCard, ['id-front']), 'id-back');
  assert.equal(nextDocumentSlot(identityCard, ['id-front', 'id-back']), null);
  assert.equal(canCompleteDocumentSession([]), false);
  assert.equal(canCompleteDocumentSession(['id-front']), false);
  assert.equal(canCompleteDocumentSession(['passport-data']), true);
  assert.equal(
    canCompleteDocumentSession(['passport-data', 'health-front']),
    false,
  );
  assert.equal(documentScanStatus(passport, ['passport-data']), 'complete');
});

test('legacy document sets hide the tax number while version 3 exposes one logical slot', () => {
  assert.deepEqual(
    scannerDocumentsForVersion(2).map(({ id }) => id),
    ['identity-card', 'passport', 'health-card'],
  );
  assert.deepEqual(
    scannerDocumentsForVersion(3).map(({ id }) => id),
    ['identity-card', 'passport', 'health-card', 'tax-id'],
  );
  assert.deepEqual(SCANNER_DOCUMENTS.find(({ id }) => id === 'tax-id').slots, [
    'tax-id',
  ]);
  assert.equal(
    SCANNER_DOCUMENTS.find(({ id }) => id === 'tax-id').title,
    'Steueridentifikationsnummer',
  );
});

test('normalizes and checks German tax identification input without exposing a correction', () => {
  assert.equal(normalizeTaxId('86 095 742 719'), '86095742719');
  assert.equal(normalizeTaxId('86\u00a0095-742\u202f719'), '86095742719');
  assert.equal(normalizeTaxId('86/095/742/719'), null);
  assert.equal(isPlausibleTaxId('86 095 742 719'), true);
  assert.equal(isPlausibleTaxId('86095742718'), false);
  assert.equal(isPlausibleTaxId('06095742719'), false);
  assert.equal(isPlausibleTaxId('12345678903'), false);
  assert.equal(isPlausibleTaxId('11123456789'), false);
});

test('selected scan plan completes only after every chosen document is complete', () => {
  assert.equal(selectedDocumentPlanComplete([], []), false);
  assert.equal(
    selectedDocumentPlanComplete(['passport'], ['passport-data']),
    true,
  );
  assert.equal(
    selectedDocumentPlanComplete(['identity-card'], ['id-front']),
    false,
  );
  assert.equal(
    selectedDocumentPlanComplete(['identity-card'], ['id-front', 'id-back']),
    true,
  );
  assert.equal(
    selectedDocumentPlanComplete(
      ['identity-card', 'passport'],
      ['id-front', 'id-back'],
    ),
    false,
  );
  assert.equal(
    selectedDocumentPlanComplete(
      ['identity-card', 'passport'],
      ['id-front', 'id-back', 'passport-data'],
    ),
    true,
  );
  assert.equal(
    selectedDocumentPlanComplete(['health-card'], ['health-front']),
    false,
  );
  assert.equal(
    selectedDocumentPlanComplete(['unknown'], ['passport-data']),
    false,
  );
});

test('selected scan plan advances within a document and always returns to the dashboard when it is complete', () => {
  assert.deepEqual(
    nextSelectedPlanStep(['identity-card'], ['id-front'], 'id-front'),
    {
      kind: 'capture',
      slot: 'id-back',
    },
  );
  assert.deepEqual(
    nextSelectedPlanStep(['identity-card'], ['id-front', 'id-back'], 'id-back'),
    {
      kind: 'dashboard',
    },
  );
  assert.deepEqual(
    nextSelectedPlanStep(
      ['identity-card', 'passport'],
      ['id-front', 'id-back'],
      'id-back',
    ),
    { kind: 'dashboard' },
  );
  assert.deepEqual(
    nextSelectedPlanStep(
      ['identity-card', 'passport'],
      ['id-front', 'id-back', 'passport-data'],
      'passport-data',
    ),
    { kind: 'dashboard' },
  );
  assert.deepEqual(
    nextSelectedPlanStep(['passport'], ['id-front'], 'id-front'),
    {
      kind: 'invalid',
    },
  );
});

test('maps the exact wide perspective guide and analyzes its asymmetric edges', () => {
  assert.deepEqual(ID_CARD_GUIDE_VIEWBOX, {
    x: 0,
    y: 0,
    width: 100,
    height: 63,
  });
  assert.deepEqual(ID_CARD_GUIDE_QUAD, {
    topLeft: { x: 14, y: 7 },
    topRight: { x: 86, y: 11 },
    bottomRight: { x: 98, y: 59 },
    bottomLeft: { x: 2, y: 55 },
  });

  const guide = { x: 10, y: 150, width: 460, height: 289.8 };
  const quad = guideQuadInRect(guide);
  assertPointClose(quad.topLeft, { x: 74.4, y: 182.2 });
  assertPointClose(quad.topRight, { x: 405.6, y: 200.6 });
  assertPointClose(quad.bottomRight, { x: 460.8, y: 421.4 });
  assertPointClose(quad.bottomLeft, { x: 19.2, y: 403 });

  const accepted = analyzeFramePosition(
    quadrilateralFrameFixture({ quad }),
    guide,
    quad,
  );
  assert.equal(accepted.positioned, true);
  assert.equal(accepted.strongEdges, 4);
  assert.match(accepted.reason, /Position passt/);
  assertPointClose(accepted.box, guide);
  assert.ok(Math.abs(accepted.box.width - guide.width) <= 1e-8);
  assert.ok(Math.abs(accepted.box.height - guide.height) <= 1e-8);
  assert.deepEqual(accepted.quad, quad);
});

test('maps an on-screen perspective guide to the exact visible camera pixels', () => {
  const viewGuide = guideQuadInRect({
    x: 20,
    y: 220,
    width: 360,
    height: 226.8,
  });
  const sourceGuide = guideQuadInSource(viewGuide, 4_000, 3_000, 400, 800);
  const visibleSource = coverSourceRect(4_000, 3_000, 400, 800);
  for (const name of ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']) {
    assertPointClose(sourceGuide[name], {
      x: visibleSource.x + (viewGuide[name].x / 400) * visibleSource.width,
      y: visibleSource.y + (viewGuide[name].y / 800) * visibleSource.height,
    });
  }
});

test('builds and draws a projective rectification mesh whose affine patches land exactly', () => {
  const sourceQuad = {
    topLeft: { x: 140, y: 70 },
    topRight: { x: 860, y: 110 },
    bottomRight: { x: 980, y: 590 },
    bottomLeft: { x: 20, y: 550 },
  };
  assertPointClose(projectPointInQuad(sourceQuad, 0, 0), sourceQuad.topLeft);
  assertPointClose(projectPointInQuad(sourceQuad, 1, 0), sourceQuad.topRight);
  assertPointClose(
    projectPointInQuad(sourceQuad, 1, 1),
    sourceQuad.bottomRight,
  );
  assertPointClose(projectPointInQuad(sourceQuad, 0, 1), sourceQuad.bottomLeft);

  const mesh = perspectiveRectificationMesh(sourceQuad, 856, 540, {
    columns: 3,
    rows: 2,
  });
  assert.equal(mesh.columns, 3);
  assert.equal(mesh.rows, 2);
  assert.equal(mesh.triangles.length, 12);
  assertPointClose(mesh.triangles[0].source[0], sourceQuad.topLeft);
  assertPointClose(mesh.triangles.at(-1).source[1], sourceQuad.bottomRight);
  assertPointClose(mesh.triangles[0].destination[0], { x: 0, y: 0 });
  assertPointClose(mesh.triangles.at(-1).destination[1], {
    x: 856,
    y: 540,
  });

  const transforms = [];
  let drawCalls = 0;
  let clips = 0;
  const context = {
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    clip() {
      clips += 1;
    },
    transform(...values) {
      transforms.push(values);
    },
    drawImage() {
      drawCalls += 1;
    },
  };
  const source = {};
  const result = drawPerspectiveQuadAsRectangle(
    context,
    source,
    sourceQuad,
    856,
    540,
    {
      columns: 3,
      rows: 2,
    },
  );
  assert.deepEqual(result, { columns: 3, rows: 2, triangleCount: 12 });
  assert.equal(clips, 12);
  assert.equal(drawCalls, 12);
  assert.equal(transforms.length, 12);

  for (let index = 0; index < mesh.triangles.length; index += 1) {
    const [a, b, c, d, e, f] = transforms[index];
    for (let point = 0; point < 3; point += 1) {
      const sourcePoint = mesh.triangles[index].source[point];
      assertPointClose(
        {
          x: a * sourcePoint.x + c * sourcePoint.y + e,
          y: b * sourcePoint.x + d * sourcePoint.y + f,
        },
        mesh.triangles[index].destination[point],
        1e-6,
      );
    }
  }
});

test('rejects malformed perspective geometry before analysis or drawing', () => {
  const crossedQuad = {
    topLeft: { x: 0, y: 0 },
    topRight: { x: 100, y: 100 },
    bottomRight: { x: 100, y: 0 },
    bottomLeft: { x: 0, y: 100 },
  };
  assert.throws(
    () => guideQuadInRect({ x: 0, y: 0, width: 100, height: 63 }, crossedQuad),
    /ungültig/,
  );
  assert.throws(
    () => perspectiveRectificationMesh(crossedQuad, 856, 540),
    /ungültig/,
  );
});

test('finds a detailed ID-1 card without rejecting ordinary placement variation', () => {
  const guide = { x: 35, y: 201, width: 410, height: 259 };
  const accepted = analyzeFramePosition(frameFixture(), guide);
  assert.equal(accepted.positioned, true);
  assert.equal(accepted.strongEdges, 4);
  assert.match(accepted.reason, /Position passt/);

  const ordinaryVariation = analyzeFramePosition(
    frameFixture({ card: { x: 132, y: 201, width: 340, height: 214 } }),
    guide,
  );
  assert.equal(ordinaryVariation.positioned, true);
});

test('accepts a low-contrast ID-1 card and anchors the hold to the visible guide', () => {
  const guide = { x: 110, y: 65, width: 260, height: 412 };
  const accepted = analyzeFramePosition(
    frameFixture({
      card: guide,
      backgroundValue: 160,
      cardValue: 190,
      textValue: 150,
    }),
    guide,
  );
  assert.equal(accepted.positioned, true);
  assert.equal(accepted.strongEdges, 4);
  assert.ok(accepted.box.height > accepted.box.width);
  assert.deepEqual(accepted.box, guide);

  const emptyGuide = analyzeFramePosition(
    frameFixture({
      card: guide,
      backgroundValue: 160,
      cardValue: 160,
      textValue: 160,
    }),
    guide,
  );
  assert.equal(emptyGuide.positioned, false);
});

test('accepts a mildly perspective ID card and ordinary sideways roll', () => {
  const guide = { x: 110, y: 65, width: 260, height: 412 };
  for (const topInsetFraction of [0.08, 0.14]) {
    const accepted = analyzeFramePosition(
      perspectiveFrameFixture({ guide, topInsetFraction }),
      guide,
    );
    assert.equal(
      accepted.positioned,
      true,
      `top inset ${topInsetFraction} should be accepted`,
    );
    assert.ok(accepted.strongEdges >= 3);
  }

  for (const rollDegrees of [-6, 6]) {
    const accepted = analyzeFramePosition(
      perspectiveFrameFixture({ guide, topInsetFraction: 0.08, rollDegrees }),
      guide,
    );
    assert.equal(
      accepted.positioned,
      true,
      `${rollDegrees} degrees of roll should be accepted`,
    );
  }

  const noisyCameraFrame = analyzeFramePosition(
    perspectiveFrameFixture({
      guide,
      topInsetFraction: 0.08,
      rollDegrees: 3,
      noiseAmplitude: 20,
    }),
    guide,
  );
  assert.equal(
    noisyCameraFrame.positioned,
    true,
    'ordinary low-light camera noise must not block the green guide',
  );
});

test('strict live gate accepts a printed document surface and rejects keyboards', () => {
  const guide = { x: 35, y: 201, width: 410, height: 259 };
  const document = analyzeFramePosition(
    plausibleDocumentFixture(),
    guide,
    null,
    {
      requireDocumentPresence: true,
      slot: 'id-front',
    },
  );
  assert.equal(document.positioned, true, JSON.stringify(document));
  assert.equal(document.documentPresent, true);
  assert.ok(document.documentEdges >= 3);
  assert.ok(document.texture.textComponents >= 8);
  assert.ok(document.texture.textBands >= 2);
  assert.equal(document.texture.gridLike, false);

  for (const light of [true, false]) {
    const keyboard = analyzeFramePosition(
      keyboardFixture({ light }),
      guide,
      null,
      {
        requireDocumentPresence: true,
        slot: 'id-front',
      },
    );
    assert.equal(
      keyboard.positioned,
      false,
      `${light ? 'light' : 'dark'} keyboard must be rejected: ${JSON.stringify(keyboard)}`,
    );
    assert.equal(keyboard.documentPresent, false);
    assert.match(keyboard.reason, /Kein Dokument erkannt|vollständig/);
  }
});

test('live guide accepts a softly focused smaller ID while final checks stay strict', () => {
  const guide = { x: 35, y: 201, width: 410, height: 259 };
  const card = { x: 76, y: 227, width: 328, height: 207 };
  const softDocument = plausibleDocumentFixture({
    card,
    backgroundValue: 132,
    cardValue: 170,
    textValue: 160,
  });
  const live = analyzeFramePosition(softDocument, guide, null, {
    requireDocumentPresence: true,
    slot: 'id-front',
  });
  assert.equal(live.positioned, true, JSON.stringify(live));
  assert.equal(live.documentPresent, true);
  assert.equal(live.texture.liveAccepted, true);
  assert.ok(live.texture.textComponents >= 3);
  assert.equal(live.texture.strongKeyboardPattern, false);

  const frozen = analyzeDocumentPresence(softDocument, {
    regionRect: card,
    slot: 'id-front',
  });
  assert.equal(
    frozen.accepted,
    false,
    'the tolerant live guide must not weaken frozen-frame validation',
  );
});

test('frozen-frame document gate rejects a keyboard before feedback or review', () => {
  const document = analyzeDocumentPresence(plausibleDocumentFixture(), {
    regionRect: { x: 35, y: 201, width: 410, height: 259 },
    slot: 'id-front',
  });
  assert.equal(document.accepted, true, JSON.stringify(document));

  for (const light of [false, true]) {
    const keyboard = analyzeDocumentPresence(keyboardFixture({ light }), {
      regionRect: { x: 35, y: 201, width: 410, height: 259 },
      slot: 'id-front',
    });
    assert.equal(
      keyboard.accepted,
      false,
      `${light ? 'light' : 'dark'} keyboard must fail frozen-frame validation`,
    );
    assert.equal(keyboard.status, 'document');
  }

  for (const light of [true, false]) {
    const staggered = analyzeDocumentPresence(
      staggeredKeyboardFixture({ light }),
      {
        regionRect: { x: 35, y: 201, width: 410, height: 259 },
        slot: 'id-front',
      },
    );
    assert.equal(
      staggered.accepted,
      false,
      `${light ? 'light' : 'dark'} staggered keyboard must fail frozen-frame validation`,
    );
    if (light) assert.equal(staggered.metrics.staggeredKeyGridLike, true);
  }
});

test('strict live gate rejects staggered laptop keys and a wide space bar', () => {
  const guide = { x: 35, y: 201, width: 410, height: 259 };
  for (const light of [true, false]) {
    const keyboard = analyzeFramePosition(
      staggeredKeyboardFixture({ light }),
      guide,
      null,
      {
        requireDocumentPresence: true,
        slot: 'id-front',
      },
    );
    assert.equal(
      keyboard.positioned,
      false,
      `${light ? 'light' : 'dark'} staggered keyboard must not start the countdown`,
    );
    assert.equal(keyboard.documentPresent, false);
    if (light) assert.equal(keyboard.texture.staggeredKeyGridLike, true);
  }
});

test('document presence rejects an empty card-shaped surface', () => {
  const empty = analyzeDocumentPresence(
    frameFixture({
      card: { x: 35, y: 201, width: 410, height: 259 },
      backgroundValue: 35,
      cardValue: 205,
      textValue: 205,
    }),
    {
      regionRect: { x: 35, y: 201, width: 410, height: 259 },
      slot: 'id-front',
    },
  );
  assert.equal(empty.accepted, false);
  assert.equal(empty.metrics.textComponents, 0);

  const guide = { x: 35, y: 201, width: 410, height: 259 };
  const liveEmpty = analyzeFramePosition(
    frameFixture({
      card: guide,
      backgroundValue: 35,
      cardValue: 205,
      textValue: 205,
    }),
    guide,
    null,
    { requireDocumentPresence: true, slot: 'id-front' },
  );
  assert.equal(liveEmpty.positioned, false);
  assert.equal(liveEmpty.documentPresent, false);
});

test('requires three real seconds of stable positioning and tolerates brief jitter', () => {
  const frameSize = { width: 480, height: 640 };
  const box = { x: 35, y: 201, width: 410, height: 259 };
  const valid = { positioned: true, box };
  const invalid = { positioned: false, box: null };
  let state = updateHoldState(createHoldState(), valid, 10_000, frameSize);
  assert.equal(state.countdown, 3);
  state = updateHoldState(state, valid, 11_001, frameSize);
  assert.equal(state.countdown, 2);
  state = updateHoldState(state, invalid, 11_200, frameSize);
  assert.equal(
    state.holding,
    true,
    'short invalid frames use the grace window',
  );
  state = updateHoldState(state, valid, 12_001, frameSize);
  assert.equal(state.countdown, 1);
  state = updateHoldState(state, valid, 13_000, frameSize);
  assert.equal(state.ready, true);
  assert.equal(state.countdown, 0);

  const readyGrace = updateHoldState(state, invalid, 13_150, frameSize);
  assert.equal(
    readyGrace.ready,
    true,
    'a noisy frame at the trigger boundary keeps the completed hold ready',
  );

  const autofocusGrace = updateHoldState(state, invalid, 13_500, frameSize);
  assert.equal(autofocusGrace.holding, true);
  assert.equal(autofocusGrace.ready, true);

  const reset = updateHoldState(state, invalid, 13_700, frameSize);
  assert.equal(reset.holding, false);
  assert.equal(reset.ready, false);
  assert.equal(reset.countdown, 3);
});

test('large movement restarts the countdown instead of capturing a moving card', () => {
  const frameSize = { width: 480, height: 640 };
  const first = updateHoldState(
    createHoldState(),
    {
      positioned: true,
      box: { x: 35, y: 201, width: 410, height: 259 },
    },
    1_000,
    frameSize,
  );
  const moved = updateHoldState(
    first,
    {
      positioned: true,
      box: { x: 58, y: 201, width: 410, height: 259 },
    },
    2_500,
    frameSize,
  );
  assert.equal(moved.stableSince, 2_500);
  assert.equal(moved.countdown, 3);
});

test('browser quality gate matches desktop resolution and sharpness thresholds', () => {
  const accepted = analyzeCaptureQuality(sharpCapture());
  assert.equal(accepted.accepted, true);
  assert.ok(accepted.metrics.contrast > 22);
  assert.ok(accepted.metrics.sharpness > 9);

  const tooSmall = analyzeCaptureQuality(sharpCapture(900, 600));
  assert.equal(tooSmall.accepted, false);
  assert.equal(tooSmall.status, 'resolution');

  const smooth = new Float32Array(1_400 * 900);
  for (let index = 0; index < smooth.length; index += 1) {
    const x = index % 1_400;
    const y = Math.floor(index / 1_400);
    smooth[index] = 132 + 54 * Math.sin(x / 70) + 26 * Math.sin(y / 58);
  }
  const blurry = analyzeCaptureQuality({
    data: smooth,
    width: 1_400,
    height: 900,
  });
  assert.equal(blurry.accepted, false);
  assert.equal(blurry.status, 'sharpness');
});

test('sharp 720p guide crops may pass native preflight before final upscale', () => {
  const fallbackCrop = sharpCapture(700, 440);
  assert.equal(analyzeCaptureQuality(fallbackCrop).status, 'resolution');
  const nativePreflight = analyzeCaptureQuality(fallbackCrop, {
    minimumLongEdge: 640,
    minimumShortEdge: 400,
    minimumSharpness: 12,
  });
  assert.equal(nativePreflight.accepted, true);
  assert.ok(nativePreflight.metrics.sharpness >= 12);
});

test('scan enhancement remains conservative and never changes alpha', () => {
  const image = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([100, 120, 140, 77, 220, 200, 180, 91]),
  };
  const before = Uint8ClampedArray.from(image.data);
  enhanceScanPixels(image);
  assert.equal(image.data[3], 77);
  assert.equal(image.data[7], 91);
  assert.ok(Math.abs(image.data[0] - before[0]) < 16);
  assert.ok(Math.abs(image.data[5] - before[5]) < 16);
});

test('cover mapping and ID crop preserve the complete card aspect', () => {
  assert.deepEqual(coverSourceRect(4_000, 3_000, 400, 800), {
    x: 1_250,
    y: 0,
    width: 1_500,
    height: 3_000,
  });
  const crop = normalizedIdCrop(
    { x: 100, y: 200, width: 800, height: 520 },
    1_000,
    1_000,
  );
  assert.ok(Math.abs(crop.width / crop.height - 85.6 / 53.98) < 1e-10);
  assert.ok(crop.x <= 100);
  assert.ok(crop.y <= 200);
  assert.ok(crop.x + crop.width >= 900);
  assert.ok(crop.y + crop.height >= 720);
});

test('fixed guide maps to the exact visible camera pixels', () => {
  const crop = guideCropInSource(
    { x: 50, y: 200, width: 300, height: 400 },
    4_000,
    3_000,
    400,
    800,
  );
  assert.deepEqual(crop, {
    x: 1_437.5,
    y: 750,
    width: 1_125,
    height: 1_500,
  });
});

test('portrait crop preserves the complete card before counterclockwise landscape rotation', () => {
  const box = { x: 110, y: 65, width: 260, height: 412 };
  const crop = normalizedIdCrop(box, 480, 640, 0.018, 'portrait');
  assert.ok(
    Math.abs(crop.width / crop.height - ID_CARD_PORTRAIT_ASPECT_RATIO) < 1e-10,
  );
  assert.ok(crop.x <= box.x);
  assert.ok(crop.y <= box.y);
  assert.ok(crop.x + crop.width >= box.x + box.width);
  assert.ok(crop.y + crop.height >= box.y + box.height);
  assert.ok(crop.x >= 0 && crop.y >= 0);
  assert.ok(crop.x + crop.width <= 480);
  assert.ok(crop.y + crop.height <= 640);

  const layout = portraitCaptureLayout({ width: 1_514, height: 2_400 });
  assert.deepEqual(layout, {
    width: 2_400,
    height: Math.floor(2_400 / ID_CARD_ASPECT_RATIO),
    clockwise: false,
  });

  const calls = [];
  const context = {
    save: () => calls.push(['save']),
    translate: (...values) => calls.push(['translate', ...values]),
    rotate: (...values) => calls.push(['rotate', ...values]),
    drawImage: (...values) => calls.push(['drawImage', ...values]),
    restore: () => calls.push(['restore']),
  };
  const source = {};
  drawPortraitCropAsLandscape(context, source, crop, 2_400, layout.height);
  assert.deepEqual(calls, [
    ['save'],
    ['translate', 0, layout.height],
    ['rotate', -Math.PI / 2],
    [
      'drawImage',
      source,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      layout.height,
      2_400,
    ],
    ['restore'],
  ]);
});

test('passport landscape capture uses its wider 125 by 88 document ratio', () => {
  const box = { x: 70, y: 120, width: 398, height: 280 };
  const crop = normalizedIdCrop(
    box,
    640,
    520,
    0.018,
    'landscape',
    PASSPORT_ASPECT_RATIO,
  );
  assert.ok(Math.abs(crop.width / crop.height - PASSPORT_ASPECT_RATIO) < 1e-10);
  assert.ok(crop.x <= box.x);
  assert.ok(crop.y <= box.y);
  assert.ok(crop.x + crop.width >= box.x + box.width);
  assert.ok(crop.y + crop.height >= box.y + box.height);
  const outputWidth = Math.floor(Math.min(2_400, crop.width));
  const outputHeight = Math.floor(outputWidth / PASSPORT_ASPECT_RATIO);
  assert.ok(outputWidth > outputHeight);
  assert.ok(
    Math.abs(outputWidth / outputHeight - PASSPORT_ASPECT_RATIO) < 0.002,
  );
});
