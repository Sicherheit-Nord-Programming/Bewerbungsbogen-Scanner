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
  assert.match(html, /scanner\.js\?v=20261009-clean-directory-v11/);
  assert.match(html, /styles\.css\?v=20261009-clean-directory-v11/);
  assert.match(html, /<title>Sicherheit Nord · Ausweisscan<\/title>/);
  assert.match(
    html,
    /rel="canonical" href="https:\/\/sicherheit-nord-ausweisscan\.web\.app\/"/,
  );
  assert.match(html, /<meta name="referrer" content="no-referrer" \/>/);
  assert.match(html, /legacy-redirect\.js\?v=20261009-clean-directory-v11/);
  assert.match(html, /class="guide-orientation">OBERKANTE</);
  assert.match(html, /Vorderseite Personalausweis/);
  assert.match(html, /sicherheit-nord-logo\.png/);
  assert.match(html, /id="dashboard"/);
  assert.match(html, /data-document="identity-card"/);
  assert.match(html, /data-document="passport"/);
  assert.match(html, /data-document="health-card"/);
  assert.match(html, /data-document="tax-id"/);
  assert.match(html, /id="tax-id-stage"/);
  assert.match(html, /id="tax-id-type"[\s\S]{0,100}Eingeben/);
  assert.match(html, /id="tax-id-photo"[\s\S]{0,120}Dokument fotografieren/);
  assert.match(
    html,
    /id="tax-id-input"[\s\S]{0,160}inputmode="numeric"[\s\S]{0,160}autocomplete="off"/,
  );
  assert.match(html, /<h1 id="dashboard-title"[^>]*>Dokumentauswahl<\/h1>/);
  assert.doesNotMatch(
    html,
    /id="start-selection"|Dokumentauswahl fertigstellen/,
  );
  assert.match(html, /id="finish-session"[\s\S]{0,80}Scan abschließen/);
  assert.match(html, /id="dashboard-status"/);
  for (const documentId of [
    'identity-card',
    'tax-id',
    'passport',
    'health-card',
  ]) {
    const cardTag = html.match(
      new RegExp(`<button(?=[^>]*data-document="${documentId}")[^>]*>`),
    )?.[0];
    assert.ok(cardTag);
    assert.doesNotMatch(cardTag, /aria-pressed=/);
  }
  assert.equal((html.match(/>Auswählbar<\/span/g) ?? []).length, 4);
  assert.doesNotMatch(
    html,
    /Auswahl scannen|>Scannen<\/span>|<small>|2 Seiten|1 Seite|Eingeben oder fotografieren/,
  );
  assert.match(html, /<strong>Steueridentifikationsnummer<\/strong>/);
  const taxIdStage = html.match(
    /<section\s+id="tax-id-stage"[\s\S]+?<\/section>/,
  )?.[0];
  assert.ok(taxIdStage);
  assert.doesNotMatch(taxIdStage, /sicherheit-nord-logo|brand-logo/);
  assert.match(
    taxIdStage,
    /<h1 id="tax-id-title"[^>]*>[\s\S]*?Steueridentifikationsnummer[\s\S]*?<\/h1>/,
  );
  assert.doesNotMatch(html, /Dokumentenübersicht|Wählen Sie ein Dokument aus/);
  assert.doesNotMatch(html, /Bitte das bereits begonnene Dokument/);
  assert.doesNotMatch(html, /Zum Laptop zurückkehren|Laptop zurückgeben/);
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
  assert.match(script, /scanner-core\.js\?v=20261009-clean-directory-v11/);
  assert.match(script, /relay-client\.js\?v=20261009-clean-directory-v11/);
  assert.match(
    script,
    /open: 'Auswählbar',[\s\S]+?selected: 'Offen',[\s\S]+?'in-progress': 'Offen',[\s\S]+?complete: 'Abgeschlossen'/,
  );
  assert.match(script, /function submitTypedTaxId\(event\)/);
  assert.match(script, /isPlausibleTaxId\(normalized\)/);
  assert.match(script, /function normalizeTaxIdPhoto\(file\)/);
  assert.match(script, /documentSetVersion/);
  assert.match(script, /uploadChunksConcurrently\(/);
  assert.match(script, /maxConcurrency:\s*2/);
  assert.match(script, /Sichere Übertragung …/);
  assert.match(script, /Übertragung wird abgeschlossen …/);
  assert.match(script, /Wird verschlüsselt …/);
  assert.match(script, /Wird übertragen …/);
  assert.match(script, /Wird bestätigt …/);
  assert.doesNotMatch(
    script,
    /Sichere Übertragung\s+\$\{index \+ 1\}\s+von\s+\$\{prepared\.chunks\.length\}/,
  );
  assert.match(script, /waitForStaticSession\(staticEndpoint, stationId/);
  assert.match(script, /decryptStaticBootstrap\(\{/);
  assert.match(script, /parseDiscoveredScannerBootstrap\(decrypted/);
  const hashRead = script.indexOf('let bootstrapHash = window.location.hash;');
  const hashRemoval = script.indexOf('window.history.replaceState(', hashRead);
  const hashParse = script.indexOf('parseScannerBootstrap(bootstrapHash)');
  assert.ok(hashRead >= 0);
  assert.ok(hashRemoval > hashRead);
  assert.ok(hashParse > hashRemoval);
  assert.match(
    script,
    /request\.slots = \[\.\.\.completedSlots\]\.sort\([\s\S]+?localeCompare/,
  );
  assert.match(script, /captureMode !== 'documents-v2'/);
  assert.match(script, /nextSelectedPlanStep\(/);
  assert.match(
    script,
    /function advanceAfterFinalizedDocumentSlot\(finalizedSide\)[\s\S]+?selectedDocumentIds\.clear\(\)[\s\S]+?selectionLocked = false;[\s\S]+?showDashboard\(\)/,
  );
  assert.match(
    script,
    /async function finishDocumentSession\(\)[\s\S]+?canCompleteDocumentSession\(completedSlots\)[\s\S]+?await confirmCompletedSession\(\)[\s\S]+?completeSession\(true\)/,
  );
  assert.doesNotMatch(
    script,
    /planStep\.kind === 'confirm'[\s\S]+?await confirmCompletedSession\(\)/,
  );
  assert.match(script, /showDashboard\(\)/);
  assert.match(
    script,
    /parsedBootstrap\.version === '2'[\s\S]+?showDashboard\(\)[\s\S]+?await resolveScannerBootstrap\(parsedBootstrap\)/,
  );
  assert.match(
    script,
    /function startDocument\(documentId\)[\s\S]+?selectedDocumentIds\.add\(documentId\)[\s\S]+?openDocument\(documentId\)/,
  );
  const openDocumentStart = script.indexOf('function openDocument(documentId)');
  const startDocumentStart = script.indexOf(
    'function startDocument(documentId)',
    openDocumentStart,
  );
  const openDocumentSource = script.slice(
    openDocumentStart,
    startDocumentStart,
  );
  assert.ok(openDocumentStart >= 0 && startDocumentStart > openDocumentStart);
  assert.doesNotMatch(openDocumentSource, /!sessionClaimed/);
  assert.match(openDocumentSource, /void requestCamera\(\)/);
  assert.match(
    script,
    /function resumeSelectedDocumentAfterClaim\(\)[\s\S]+?side = nextSlot[\s\S]+?resumeOrRequestCamera\(\)/,
  );
  assert.match(
    script,
    /sessionClaimed = true;[\s\S]+?resumeSelectedDocumentAfterClaim\(\)/,
  );
  assert.match(script, /else startDocument\(card\.dataset\.document\)/);
  assert.doesNotMatch(
    script,
    /toggleDocumentSelection|startSelectedDocuments|elements\.startSelection/,
  );
  assert.match(
    script,
    /elements\.useCapture\.disabled =[\s\S]+?!sessionClaimed/,
  );
  assert.match(
    script,
    /if \(!window\.__SN_SCANNER_REDIRECTING__\) void start\(\);/,
  );
  assert.match(script, /side = 'back'/);
  assert.match(script, /Rückseite Personalausweis/);
  assert.match(script, /acceptedCapture = result;[\s\S]{0,250}stopCamera\(\)/);
  assert.match(script, /visibilitychange/);
  assert.match(
    script,
    /visibilitychange[\s\S]+?document\.visibilityState === 'hidden'[\s\S]+?stopCamera\(\)[\s\S]+?setCameraMessage\('Kamera wird geöffnet …',[\s\S]+?void requestCamera\(\)/,
  );
  assert.doesNotMatch(
    script,
    /visibilitychange[\s\S]+?Bitte Kamera erneut öffnen[\s\S]+?startCamera\.hidden = false/,
  );
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
  assert.match(
    styles,
    /#dashboard-title:focus,[\s\S]+?#complete:focus\s*\{[\s\S]+?outline:\s*none/,
  );
  assert.match(
    styles,
    /\.document-card:not\(:disabled\):active,[\s\S]+?\.primary:not\(:disabled\):active,[\s\S]+?\.secondary:not\(:disabled\):active,[\s\S]+?\.camera-action:not\(:disabled\):active\s*\{[\s\S]+?scale:\s*0\.98[\s\S]+?filter:\s*brightness\(0\.95\)[\s\S]+?transition-duration:\s*70ms/,
  );
  assert.match(styles, /grid-auto-rows:\s*1fr/);
  assert.match(styles, /\.document-card:not\(:disabled\):hover/);
  assert.match(styles, /\.torch-toggle\.is-on/);
  assert.match(
    styles,
    /\.document-copy strong\s*\{[\s\S]+?hyphens:\s*auto[\s\S]+?overflow-wrap:\s*anywhere/,
  );
  const startCameraRule = styles.match(/\.start-camera\s*\{([\s\S]*?)\}/)?.[1];
  assert.ok(startCameraRule);
  assert.match(startCameraRule, /top:\s*max\(76px,/);
  assert.doesNotMatch(startCameraRule, /top:\s*62%/);
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

test('neutral Firebase hosting is isolated and old QR links retain their fragment', async () => {
  const [firebaseSource, projectSource, redirect] = await Promise.all([
    readFile(new URL('firebase.json', directory), 'utf8'),
    readFile(new URL('.firebaserc', directory), 'utf8'),
    readFile(new URL('legacy-redirect.js', directory), 'utf8'),
  ]);
  const firebase = JSON.parse(firebaseSource);
  const project = JSON.parse(projectSource);
  assert.equal(project.projects.default, 'sicherheit-nord-aufschaltung');
  assert.equal(firebase.hosting.site, 'sicherheit-nord-ausweisscan');
  assert.equal(firebase.hosting.public, '.');
  assert.ok(firebase.hosting.ignore.includes('firebase.json'));
  assert.ok(firebase.hosting.ignore.includes('.firebaserc'));
  assert.ok(firebase.hosting.ignore.includes('**/*.test.js'));
  const headers = Object.fromEntries(
    firebase.hosting.headers[0].headers.map(({ key, value }) => [key, value]),
  );
  assert.equal(headers['Cache-Control'], 'no-cache, no-store, must-revalidate');
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(
    headers['Permissions-Policy'],
    'camera=(self), microphone=(), geolocation=()',
  );
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.match(redirect, /sicherheit-nord-programming\.github\.io/);
  assert.match(redirect, /sicherheit-nord-ausweisscan\.web\.app/);
  assert.match(redirect, /destination\.search = window\.location\.search/);
  assert.match(redirect, /destination\.hash = window\.location\.hash/);
  assert.match(redirect, /window\.__SN_SCANNER_REDIRECTING__ = true/);
  assert.match(redirect, /window\.location\.replace\(destination\.href\)/);
});

test('a dashboard return detaches an in-flight camera request from the next document', async () => {
  const scannerUrl = new URL('scanner.js', directory);
  const scannerCoreUrl = new URL('scanner-core.js', directory).href;
  const relayClientUrl = new URL('relay-client.js', directory).href;
  const source = await readFile(scannerUrl, 'utf8');
  const instrumentedSource = source
    .replace(
      "from './scanner-core.js?v=20261009-clean-directory-v11';",
      `from ${JSON.stringify(scannerCoreUrl)};`,
    )
    .replace(
      "from './relay-client.js?v=20261009-clean-directory-v11';",
      `from ${JSON.stringify(relayClientUrl)};`,
    )
    .replace(
      /\n(?:if \(!window\.__SN_SCANNER_REDIRECTING__\) )?void start\(\);\s*$/,
      `
export {
  advanceAfterFinalizedDocumentSlot,
  backToDashboard,
  requestCamera,
  startDocument,
  stopCamera,
};
export function prepareDashboardLifecycleTest() {
  protocolVersion = '2';
  captureMode = 'documents-v2';
  sessionClaimed = true;
  sessionClosed = false;
  pendingConfirm = false;
  busy = false;
  selectionLocked = false;
  selectedDocumentIds.clear();
  state = 'dashboard';
}
export function preparePreclaimLifecycleTest() {
  protocolVersion = '2';
  captureMode = 'documents-v2';
  sessionClaimed = false;
  selectionLocked = false;
  selectedDocumentIds.clear();
  state = 'dashboard';
}
export function finishPreclaimLifecycleTest() {
  sessionClaimed = true;
  resumeSelectedDocumentAfterClaim();
}
export function prepareCompletedIdentityDocumentTest() {
  protocolVersion = '2';
  captureMode = 'documents-v2';
  sessionClaimed = true;
  sessionClosed = false;
  pendingConfirm = false;
  selectionLocked = true;
  selectedDocumentIds.clear();
  selectedDocumentIds.add('identity-card');
  completedSlots.clear();
  completedSlots.add('id-front');
  elements.dashboard.hidden = true;
  elements.complete.hidden = true;
  state = 'review';
}
export function preparePendingConfirmDashboardTest() {
  protocolVersion = '2';
  captureMode = 'documents-v2';
  sessionClaimed = true;
  sessionClosed = false;
  pendingConfirm = true;
  selectionLocked = false;
  selectedDocumentIds.clear();
  completedSlots.clear();
  completedSlots.add('id-front');
  completedSlots.add('id-back');
  state = 'dashboard';
  renderDashboard();
}
export function documentLifecycleState() {
  return {
    state,
    sessionClosed,
    pendingConfirm,
    selectionLocked,
    selectedDocumentIds: [...selectedDocumentIds],
    completedSlots: [...completedSlots],
    dashboardHidden: elements.dashboard.hidden,
    completeHidden: elements.complete.hidden,
    finishHidden: elements.documentFinish.hidden,
    finishDisabled: elements.finishSession.disabled,
  };
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
  assert.doesNotMatch(
    instrumentedSource,
    /\n(?:if \(!window\.__SN_SCANNER_REDIRECTING__\) )?void start\(\);\s*$/,
  );

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
          readyState: 2,
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
  const thirdCamera = deferred();
  const hiddenCamera = deferred();
  const resumedCamera = deferred();
  const pendingCameras = [
    firstCamera,
    secondCamera,
    thirdCamera,
    hiddenCamera,
    resumedCamera,
  ];
  let getUserMediaCalls = 0;
  let animationFrameCalls = 0;
  let scanner;
  const documentListeners = new Map();
  const mockDocument = {
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    getElementById: element,
    visibilityState: 'visible',
  };

  try {
    defineGlobal('cancelAnimationFrame', () => {});
    defineGlobal('requestAnimationFrame', () => {
      animationFrameCalls += 1;
      return animationFrameCalls;
    });
    defineGlobal('innerHeight', 844);
    defineGlobal('innerWidth', 390);
    defineGlobal('HTMLButtonElement', class {});
    defineGlobal('document', mockDocument);
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
    scanner.startDocument('identity-card');
    const firstResult = scanner.cameraLifecycleState().cameraPromise;
    scanner.backToDashboard();
    scanner.startDocument('passport');
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

    const thirdStream = createStream();
    animationFrameCalls = 0;
    scanner.preparePreclaimLifecycleTest();
    scanner.startDocument('health-card');
    const thirdResult = scanner.cameraLifecycleState().cameraPromise;
    assert.ok(thirdResult);
    thirdCamera.resolve(thirdStream);
    assert.equal(await thirdResult, true);
    assert.equal(
      animationFrameCalls,
      0,
      'automatic analysis must wait for the secure relay claim',
    );

    scanner.finishPreclaimLifecycleTest();
    assert.equal(
      animationFrameCalls,
      1,
      'the relay claim must resume the open camera and start analysis',
    );
    scanner.stopCamera();
    assert.equal(thirdStream.track.stopCalls, 1);

    scanner.prepareCompletedIdentityDocumentTest();
    scanner.advanceAfterFinalizedDocumentSlot('id-back');
    assert.deepEqual(scanner.documentLifecycleState(), {
      state: 'dashboard',
      sessionClosed: false,
      pendingConfirm: false,
      selectionLocked: false,
      selectedDocumentIds: [],
      completedSlots: ['id-front', 'id-back'],
      dashboardHidden: false,
      completeHidden: true,
      finishHidden: false,
      finishDisabled: false,
    });

    scanner.preparePendingConfirmDashboardTest();
    scanner.startDocument('passport');
    assert.equal(
      getUserMediaCalls,
      3,
      'an uncertain final confirmation must block every new camera request',
    );
    assert.deepEqual(scanner.documentLifecycleState(), {
      state: 'dashboard',
      sessionClosed: false,
      pendingConfirm: true,
      selectionLocked: false,
      selectedDocumentIds: [],
      completedSlots: ['id-front', 'id-back'],
      dashboardHidden: false,
      completeHidden: true,
      finishHidden: false,
      finishDisabled: false,
    });

    scanner.prepareDashboardLifecycleTest();
    scanner.startDocument('passport');
    const interruptedResult = scanner.cameraLifecycleState().cameraPromise;
    assert.ok(interruptedResult);
    assert.equal(getUserMediaCalls, 4);

    mockDocument.visibilityState = 'hidden';
    documentListeners.get('visibilitychange')();
    assert.equal(scanner.cameraLifecycleState().hasCameraRequest, false);

    const interruptedStream = createStream();
    hiddenCamera.resolve(interruptedStream);
    assert.equal(await interruptedResult, false);
    assert.equal(interruptedStream.track.stopCalls, 1);

    mockDocument.visibilityState = 'visible';
    documentListeners.get('visibilitychange')();
    const resumedResult = scanner.cameraLifecycleState().cameraPromise;
    assert.ok(resumedResult);
    assert.equal(
      getUserMediaCalls,
      5,
      'returning to the active scan must reopen the camera automatically',
    );

    documentListeners.get('visibilitychange')();
    assert.equal(
      getUserMediaCalls,
      5,
      'repeated visible events must reuse the in-flight camera request',
    );

    const resumedStream = createStream();
    resumedCamera.resolve(resumedStream);
    assert.equal(await resumedResult, true);
    assert.equal(scanner.cameraLifecycleState().mediaStream, resumedStream);
    assert.equal(element('start-camera').hidden, true);
    scanner.stopCamera();
    assert.equal(resumedStream.track.stopCalls, 1);
  } finally {
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
