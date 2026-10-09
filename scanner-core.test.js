import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  analyzeCaptureQuality,
  analyzeFramePosition,
  canCompleteDocumentSession,
  coverSourceRect,
  createHoldState,
  documentScanStatus,
  drawPortraitCropAsLandscape,
  enhanceScanPixels,
  guideCropInSource,
  ID_CARD_ASPECT_RATIO,
  ID_CARD_PORTRAIT_ASPECT_RATIO,
  isPlausibleTaxId,
  nextDocumentSlot,
  nextSelectedPlanStep,
  normalizedIdCrop,
  parseDiscoveredScannerBootstrap,
  parseScannerBootstrap,
  PASSPORT_ASPECT_RATIO,
  portraitCaptureLayout,
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

  assert.throws(
    () => parseScannerBootstrap(qrFragment({ v: '4' })),
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

test('legacy document sets hide Steuer-ID while version 3 exposes one logical slot', () => {
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
});

test('normalizes and checks German Steuer-ID input without exposing a correction', () => {
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
    { kind: 'capture', slot: 'id-back' },
  );
  assert.deepEqual(
    nextSelectedPlanStep(['identity-card'], ['id-front', 'id-back'], 'id-back'),
    { kind: 'dashboard' },
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
    { kind: 'invalid' },
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

test('passport capture uses its wider 125 by 88 document ratio', () => {
  const box = { x: 120, y: 70, width: 280, height: 398 };
  const crop = normalizedIdCrop(
    box,
    520,
    640,
    0.018,
    'portrait',
    PASSPORT_ASPECT_RATIO,
  );
  assert.ok(
    Math.abs(crop.width / crop.height - 1 / PASSPORT_ASPECT_RATIO) < 1e-10,
  );
  const layout = portraitCaptureLayout(crop, 2_400, PASSPORT_ASPECT_RATIO);
  const expectedWidth = Math.floor(Math.min(2_400, crop.height));
  assert.equal(layout.width, expectedWidth);
  assert.equal(
    layout.height,
    Math.floor(expectedWidth / PASSPORT_ASPECT_RATIO),
  );
});
