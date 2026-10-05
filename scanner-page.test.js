import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const directory = new URL('./', import.meta.url);

test('standalone page contains a live camera guide without external code', async () => {
  const [html, script, styles] = await Promise.all([
    readFile(new URL('index.html', directory), 'utf8'),
    readFile(new URL('scanner.js', directory), 'utf8'),
    readFile(new URL('styles.css', directory), 'utf8'),
  ]);
  assert.match(html, /<video[^>]+autoplay[^>]+muted[^>]+playsinline/);
  assert.match(html, /id="id-guide"/);
  assert.match(html, /id="countdown"/);
  assert.match(html, /scanner\.js\?v=20261005-auto-scan-plan/);
  assert.match(html, /styles\.css\?v=20261005-auto-scan-plan/);
  assert.match(html, /<title>Sicherheit Nord · Ausweisscan<\/title>/);
  assert.match(html, /class="guide-orientation">OBERKANTE</);
  assert.match(html, /Vorderseite Personalausweis/);
  assert.match(html, /sicherheit-nord-logo\.png/);
  assert.match(html, /id="dashboard"/);
  assert.match(html, /data-document="identity-card"/);
  assert.match(html, /data-document="passport"/);
  assert.match(html, /data-document="health-card"/);
  assert.match(html, /<h1 id="dashboard-title"[^>]*>Dokumentauswahl<\/h1>/);
  assert.match(html, /id="start-selection"[^>]+disabled/);
  assert.doesNotMatch(html, /Dokumentenübersicht|Wählen Sie ein Dokument aus/);
  assert.doesNotMatch(html, /Bitte das bereits begonnene Dokument/);
  assert.doesNotMatch(html, /id="finish-session"|Scan abschließen/);
  assert.doesNotMatch(html, /document-icon/);
  assert.match(html, /id="torch-toggle"/);
  assert.match(html, /id="back-to-dashboard"/);
  assert.doesNotMatch(
    html,
    /Vorderseite · 1 von 2|Pilotbetrieb|id="instruction"/,
  );
  assert.doesNotMatch(html, /quality-message/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /<script[^>]+src="https:/);
  assert.match(script, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(script, /Oberkante nach rechts/);
  assert.doesNotMatch(script, /Oberkante nach links/);
  assert.match(script, /facingMode: \{ ideal: 'environment' \}/);
  assert.doesNotMatch(script, /\bzoom\b/i);
  assert.match(script, /resizeMode = \{ ideal: 'none' \}/);
  assert.doesNotMatch(
    script,
    /ImageCapture|takePhoto|STILL_CAPTURE_TIMEOUT_MS/,
  );
  assert.match(script, /navigator\.vibrate\(CAPTURE_VIBRATION_PATTERN\)/);
  assert.match(script, /capabilities\?\.torch === true/);
  assert.match(script, /advanced: \[\{ torch: Boolean\(enabled\) \}\]/);
  assert.match(script, /activeVideoTrack[\s\S]+?torch: false/);
  assert.match(script, /holdState\.ready && lastPositionedBox/);
  assert.match(script, /triggerCaptureFeedback\(\)/);
  assert.match(script, /const still = captureVideoFrame\(\)/);
  assert.match(script, /guideCropInSource\(/);
  assert.match(
    script,
    /const crop = normalizedIdCrop\([\s\S]+?0,[\s\S]+?'portrait'/,
  );
  assert.doesNotMatch(script, /mapBoxToSource/);
  assert.match(script, /normalizedIdCrop\([\s\S]+?'portrait'/);
  assert.match(script, /drawPortraitCropAsLandscape\(/);
  assert.match(script, /VIDEO_FALLBACK_OUTPUT_LONG_EDGE = 1_600/);
  assert.match(script, /minimumSharpness: VIDEO_FALLBACK_MIN_SHARPNESS/);
  assert.match(script, /analyzeFramePosition/);
  assert.match(script, /analyzeCaptureQuality/);
  assert.match(
    script,
    /enhanceScanPixels\(image\)[\s\S]+analyzeCaptureQuality\(finalImage\)/,
  );
  assert.match(script, /prepareEncryptedCapture/);
  assert.match(script, /protocolVersion,/);
  assert.match(
    script,
    /request\.slots = \[\.\.\.completedSlots\]\.sort\([\s\S]+?localeCompare/,
  );
  assert.match(script, /captureMode !== 'documents-v2'/);
  assert.match(script, /nextSelectedPlanStep\(/);
  assert.match(
    script,
    /planStep\.kind === 'confirm'[\s\S]+?await confirmCompletedSession\(\)/,
  );
  assert.doesNotMatch(script, /finishDocumentSession/);
  assert.match(script, /showDashboard\(\)/);
  assert.match(script, /side = 'back'/);
  assert.match(script, /Rückseite Personalausweis/);
  assert.match(script, /acceptedCapture = result;[\s\S]{0,250}stopCamera\(\)/);
  assert.match(script, /visibilitychange/);
  assert.match(script, /pagehide/);
  assert.match(
    styles,
    /\.id-guide\s*\{[\s\S]*?aspect-ratio:\s*53\.98\s*\/\s*85\.6/,
  );
  assert.match(
    styles,
    /\.id-guide\.is-passport,[\s\S]*?aspect-ratio:\s*88\s*\/\s*125/,
  );
  assert.match(styles, /\.document-status\.is-in-progress/);
  assert.match(styles, /\.document-card\.is-selected/);
  assert.match(styles, /\.document-card:not\(:disabled\):hover/);
  assert.match(styles, /\.torch-toggle\.is-on/);
  const guideRule = styles.match(/\.id-guide\s*\{([\s\S]*?)\}/)?.[1];
  assert.ok(guideRule);
  assert.match(guideRule, /width:\s*min\(75vw,\s*44dvh,\s*300px\)/);
  assert.doesNotMatch(guideRule, /88vw|430px/);
  const orientationRule = styles.match(
    /\.guide-orientation\s*\{([\s\S]*?)\}/,
  )?.[1];
  assert.ok(orientationRule);
  assert.match(orientationRule, /right:\s*0/);
  assert.match(orientationRule, /rotate\(90deg\)/);
  assert.doesNotMatch(orientationRule, /left:\s*0/);
  const previewRule = styles.match(/#preview\s*\{([\s\S]*?)\}/)?.[1];
  assert.ok(previewRule);
  assert.match(previewRule, /width:\s*158\.58%/);
  assert.match(previewRule, /rotate\(90deg\)/);
  const previewFrameRule = styles.match(
    /\.preview-frame\s*\{([\s\S]*?)\}/,
  )?.[1];
  assert.ok(previewFrameRule);
  assert.doesNotMatch(previewFrameRule, /border:\s*3px/);
  assert.match(previewFrameRule, /width:\s*min\(75vw,\s*44vh,\s*300px\)/);
  assert.match(previewFrameRule, /width:\s*min\(75vw,\s*44dvh,\s*300px\)/);
  assert.match(previewFrameRule, /aspect-ratio:\s*53\.98\s*\/\s*85\.6/);
  assert.match(
    styles,
    /\.preview-frame::after\s*\{[\s\S]+?inset:\s*0[\s\S]+?border:\s*3px solid #24d28c/,
  );
  assert.match(
    styles,
    /@media \(orientation: landscape\)[\s\S]+?\.id-guide,\s*\.preview-frame\s*\{[\s\S]+?width:\s*min\(44dvh,\s*260px\)/,
  );
});

test('a dashboard return detaches an in-flight camera request from the next document', async () => {
  const scannerUrl = new URL('scanner.js', directory);
  const scannerCoreUrl = new URL('scanner-core.js', directory).href;
  const relayClientUrl = new URL('relay-client.js', directory).href;
  const source = await readFile(scannerUrl, 'utf8');
  const instrumentedSource = source
    .replace(
      "from './scanner-core.js';",
      `from ${JSON.stringify(scannerCoreUrl)};`,
    )
    .replace(
      "from './relay-client.js';",
      `from ${JSON.stringify(relayClientUrl)};`,
    )
    .replace(
      /\nvoid start\(\);\s*$/,
      `
export { backToDashboard, openDocument, requestCamera, stopCamera };
export function prepareDashboardLifecycleTest() {
  protocolVersion = '2';
  captureMode = 'documents-v2';
  sessionClaimed = true;
  selectionLocked = true;
  selectedDocumentIds.add('identity-card');
  selectedDocumentIds.add('passport');
  state = 'dashboard';
}
export function cameraLifecycleState() {
  return {
    cameraPromise: cameraRequest?.promise ?? null,
    mediaStream,
    hasCameraRequest: Boolean(cameraRequest),
  };
}
`,
    );
  assert.doesNotMatch(instrumentedSource, /\nvoid start\(\);\s*$/);

  const originalGlobals = new Map(
    [
      'cancelAnimationFrame',
      'document',
      'HTMLButtonElement',
      'innerHeight',
      'innerWidth',
      'navigator',
      'requestAnimationFrame',
      'window',
    ].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  const defineGlobal = (name, value) =>
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  const classList = () => ({
    add() {},
    remove() {},
    toggle() {},
  });
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      const value = {
        checked: false,
        classList: classList(),
        disabled: false,
        firstElementChild: { style: {} },
        focus() {},
        hidden: false,
        parentElement: { classList: classList() },
        pause() {},
        removeAttribute() {},
        removeEventListener() {},
        setAttribute() {},
        addEventListener() {},
        style: {},
        textContent: '',
      };
      if (id === 'camera') {
        Object.assign(value, {
          play: async () => {},
          readyState: 1,
          srcObject: null,
          videoHeight: 1_920,
          videoWidth: 1_080,
        });
      }
      if (id === 'document-list') value.querySelector = () => null;
      elements.set(id, value);
    }
    return elements.get(id);
  };
  const deferred = () => {
    let resolve;
    const promise = new Promise((next) => {
      resolve = next;
    });
    return { promise, resolve };
  };
  const createStream = () => {
    const track = {
      applyConstraints: async () => {},
      getCapabilities: () => ({}),
      readyState: 'live',
      stopCalls: 0,
      stop() {
        this.stopCalls += 1;
      },
    };
    return {
      getTracks: () => [track],
      getVideoTracks: () => [track],
      track,
    };
  };
  const firstCamera = deferred();
  const secondCamera = deferred();
  const pendingCameras = [firstCamera, secondCamera];
  let getUserMediaCalls = 0;
  let scanner;

  try {
    defineGlobal('cancelAnimationFrame', () => {});
    defineGlobal('requestAnimationFrame', () => 1);
    defineGlobal('innerHeight', 844);
    defineGlobal('innerWidth', 390);
    defineGlobal('HTMLButtonElement', class {});
    defineGlobal('document', {
      addEventListener() {},
      getElementById: element,
      visibilityState: 'visible',
    });
    defineGlobal('window', {
      addEventListener() {},
      clearTimeout,
      setTimeout,
    });
    defineGlobal('navigator', {
      mediaDevices: {
        getSupportedConstraints: () => ({}),
        getUserMedia: () => {
          const pending = pendingCameras[getUserMediaCalls];
          getUserMediaCalls += 1;
          assert.ok(pending, 'unexpected additional camera request');
          return pending.promise;
        },
      },
    });

    scanner = await import(
      `data:text/javascript;base64,${Buffer.from(instrumentedSource).toString('base64')}`
    );
    const firstStream = createStream();
    const secondStream = createStream();

    scanner.prepareDashboardLifecycleTest();
    scanner.openDocument('identity-card');
    const firstResult = scanner.cameraLifecycleState().cameraPromise;
    scanner.backToDashboard();
    scanner.openDocument('passport');
    const secondResult = scanner.cameraLifecycleState().cameraPromise;
    assert.ok(firstResult);
    assert.ok(secondResult);
    assert.equal(
      getUserMediaCalls,
      2,
      'the new document must start a fresh getUserMedia request immediately',
    );

    firstCamera.resolve(firstStream);
    assert.equal(await firstResult, false);
    assert.equal(firstStream.track.stopCalls, 1);
    assert.equal(scanner.cameraLifecycleState().cameraPromise, secondResult);

    const repeatedSecondResult = scanner.requestCamera();
    assert.equal(
      getUserMediaCalls,
      2,
      'the stale request must not clear the newer in-flight request',
    );

    secondCamera.resolve(secondStream);
    assert.equal(await secondResult, true);
    assert.equal(await repeatedSecondResult, true);
    assert.equal(secondStream.track.stopCalls, 0);
    assert.equal(scanner.cameraLifecycleState().mediaStream, secondStream);
    assert.equal(scanner.cameraLifecycleState().hasCameraRequest, false);

    scanner.stopCamera();
    assert.equal(secondStream.track.stopCalls, 1);
  } finally {
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
