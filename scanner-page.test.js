import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const directory = new URL('./', import.meta.url);

test('local OCR runtime and German language model are pinned and self-hosted', async () => {
  const expectedHashes = new Map([
    [
      'ocr-v1/runtime/tesseract.esm.min.js',
      '64871d76c75609fd5413b88a8171e2ef40deedd77d5875ba23df104b2d05eb29',
    ],
    [
      'ocr-v1/runtime/worker.min.js',
      '576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d',
    ],
    [
      'ocr-v1/core/tesseract-core-lstm.wasm.js',
      'eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680',
    ],
    [
      'ocr-v1/core/tesseract-core-simd-lstm.wasm.js',
      'c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38',
    ],
    [
      'ocr-v1/core/tesseract-core-relaxedsimd-lstm.wasm.js',
      '861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3',
    ],
    [
      'ocr-v1/lang/deu.traineddata.gz',
      '306c4280d0cbed46fbff727486bd43b92730181bae80f56941a091f363bdf28b',
    ],
  ]);

  for (const [relativePath, expectedHash] of expectedHashes) {
    const contents = await readFile(new URL(relativePath, directory));
    assert.equal(
      createHash('sha256').update(contents).digest('hex'),
      expectedHash,
      `${relativePath} must remain the reviewed dependency artifact`,
    );
  }

  const adapter = await readFile(
    new URL('document-recognizer.js', directory),
    'utf8',
  );
  assert.match(adapter, /\.\/ocr-v1\/runtime\/tesseract\.esm\.min\.js/);
  assert.match(adapter, /workerPath: WORKER_PATH/);
  assert.match(adapter, /corePath: CORE_PATH/);
  assert.match(adapter, /langPath: LANGUAGE_PATH/);
  assert.match(adapter, /parseOcrTsvLines/);
  assert.match(adapter, /\{ text: true, tsv: true \}/);
  assert.match(adapter, /let recognitionGeneration = 0/);
  assert.match(adapter, /assertCurrentRecognition\(generation\)/);
  assert.match(adapter, /export async function cancelDocumentRecognition\(\)/);
  assert.match(adapter, /const queuedBeforeCancellation = serialJob/);
  assert.doesNotMatch(adapter, /https?:\/\//);
});

test('standalone page contains a live camera guide without external code', async () => {
  const [html, script, styles] = await Promise.all([
    readFile(new URL('index.html', directory), 'utf8'),
    readFile(new URL('scanner.js', directory), 'utf8'),
    readFile(new URL('styles.css', directory), 'utf8'),
  ]);
  assert.match(html, /<video[^>]+autoplay[^>]+muted[^>]+playsinline/);
  assert.match(html, /id="id-guide"/);
  assert.match(
    html,
    /<link rel="icon" type="image\/png" href="\.\/sicherheit-nord-logo\.png" \/>/,
  );
  const guideMarkup = html.match(
    /<div id="id-guide"[^>]*>([\s\S]*?)<\/div>/,
  )?.[1];
  assert.ok(guideMarkup);
  assert.equal((guideMarkup.match(/class="corner /g) ?? []).length, 4);
  assert.match(guideMarkup, /class="corner top-left"/);
  assert.match(guideMarkup, /class="corner top-right"/);
  assert.match(guideMarkup, /class="corner bottom-left"/);
  assert.match(guideMarkup, /class="corner bottom-right"/);
  assert.doesNotMatch(guideMarkup, /guide-outline|<polygon|<svg/);
  assert.match(html, /id="countdown"/);
  assert.match(html, /id="rotate-phone"/);
  assert.match(html, /Handy waagerecht drehen/);
  assert.match(html, /scanner\.js\?v=20261015-compact-qr-v29/);
  assert.match(html, /styles\.css\?v=20261014-passport-landscape-v24/);
  assert.match(html, /<title>Sicherheit Nord · Ausweisscan<\/title>/);
  assert.match(
    html,
    /rel="canonical" href="https:\/\/sicherheit-nord-ausweisscan\.web\.app\/"/,
  );
  assert.match(html, /<meta name="referrer" content="no-referrer" \/>/);
  assert.match(html, /legacy-redirect\.js\?v=20261010-tax-id-start-v16/);
  assert.match(html, /class="guide-orientation">OBERKANTE</);
  assert.doesNotMatch(html, /guide-angle-hint/);
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
  assert.match(
    html,
    /id="finish-session"[\s\S]{0,100}disabled[\s\S]{0,80}Fertig/,
  );
  assert.match(html, /id="document-finish" class="document-finish">/);
  assert.match(html, /id="dashboard-status"/);
  assert.match(html, /id="document-preview"/);
  assert.match(html, /id="document-preview-grid"/);
  assert.match(html, /id="document-preview-back"[\s\S]{0,120}Übersicht/);
  assert.match(html, /id="image-preview"[\s\S]{0,100}role="dialog"/);
  assert.match(html, /id="image-preview-image"/);
  const documentPositions = [
    'identity-card',
    'passport',
    'health-card',
    'tax-id',
  ].map((documentId) => html.indexOf(`data-document="${documentId}"`));
  assert.ok(documentPositions.every((position) => position >= 0));
  assert.deepEqual(
    documentPositions,
    [...documentPositions].sort((left, right) => left - right),
  );
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
  assert.match(script, /Oberkante oben\. Handy waagerecht halten\./);
  assert.match(script, /Bitte stillhalten\. Dokument wird geprüft …/);
  assert.match(script, /Bitte das Dokument ruhig in den Rahmen halten\./);
  assert.match(script, /Bitte das Dokument bereithalten\./);
  assert.match(script, /setCameraMessage\(activeProfile\(\)\.instruction\);/);
  assert.doesNotMatch(
    script,
    /Sichere Sitzung wird vorbereitet|Dokument wird lokal geprüft|Das Kamerabild wird vorbereitet/,
  );
  assert.match(script, /function phoneViewportIsLandscape\(\)/);
  assert.match(script, /window\.visualViewport/);
  assert.match(script, /function updatePhoneOrientation\(\)/);
  assert.match(
    script,
    /function resumeAnalysisWhenCameraReady\(\)[\s\S]+?readyState >= 2[\s\S]+?orientationResumeFrame = requestAnimationFrame\(resume\)/,
  );
  assert.match(
    script,
    /function stopCamera\(\)[\s\S]+?cancelAnimationFrame\(orientationResumeFrame\)/,
  );
  assert.match(script, /Handy waagerecht drehen\./);
  assert.match(
    script,
    /window\.addEventListener\('orientationchange', schedulePhoneOrientationRefresh\)/,
  );
  assert.match(
    script,
    /window\.visualViewport\?\.addEventListener\([\s\S]+?'resize',[\s\S]+?schedulePhoneOrientationRefresh/,
  );
  assert.doesNotMatch(script, /Oberkante nach rechts|Oberkante nach links/);
  assert.match(script, /facingMode: \{ ideal: 'environment' \}/);
  assert.doesNotMatch(script, /\bzoom\b/i);
  assert.match(script, /resizeMode = \{ ideal: 'none' \}/);
  assert.doesNotMatch(
    script,
    /ImageCapture|takePhoto|STILL_CAPTURE_TIMEOUT_MS/,
  );
  assert.match(script, /navigator\.vibrate\(CAPTURE_VIBRATION_PATTERN\)/);
  assert.match(script, /capabilities\?\.torch === true/);
  assert.match(script, /advanced: \[\{ torch: requested \}\]/);
  assert.match(script, /activeVideoTrack[\s\S]+?torch: false/);
  assert.match(
    script,
    /holdState\.ready &&[\s\S]+?observation\.documentPresent &&[\s\S]+?lastPositionedBox/,
  );
  assert.match(
    script,
    /analyzeFramePosition\(image, frame\.guideRect, null, \{[\s\S]+?requireDocumentPresence: true,[\s\S]+?slot: side/,
  );
  assert.match(
    script,
    /if \(!observation\.documentPresent \|\| !signature\) \{[\s\S]+?holdState = createHoldState\(\);[\s\S]+?lastPositionedBox = null/,
  );
  assert.match(
    script,
    /analyzeDocumentPresence\(image, \{[\s\S]+?slot: capturedSlot,[\s\S]+?\}\)/,
  );
  assert.match(script, /triggerCaptureFeedback\(\)/);
  const capturePreparation = script.indexOf('async function produceCapture');
  const frozenGate = script.indexOf(
    'if (!documentPresence.accepted)',
    capturePreparation,
  );
  const frozenDocumentTypeGate = script.indexOf(
    'const recognition = await recognizeDocumentCanvas(canvas, capturedSlot)',
    capturePreparation,
  );
  const rejectedDocumentTypeGate = script.indexOf(
    'if (!recognition.accepted)',
    frozenDocumentTypeGate,
  );
  const captureFeedback = script.indexOf(
    'triggerCaptureFeedback();',
    capturePreparation,
  );
  const jpegEncoding = script.indexOf(
    'canvasToJpeg(canvas)',
    capturePreparation,
  );
  assert.ok(
    frozenGate >= 0 &&
      frozenDocumentTypeGate > frozenGate &&
      rejectedDocumentTypeGate > frozenDocumentTypeGate &&
      captureFeedback > rejectedDocumentTypeGate &&
      jpegEncoding > captureFeedback,
    'feedback must happen after frozen-frame geometry and document-type validation but before JPEG encoding',
  );
  assert.match(script, /const still = captureVideoFrame\(\)/);
  assert.match(script, /guideCropInSource\(/);
  assert.equal(
    (script.match(/captureOrientation: 'portrait'/g) ?? []).length,
    0,
  );
  assert.equal(
    (script.match(/captureOrientation: 'landscape'/g) ?? []).length,
    8,
  );
  assert.match(
    script,
    /'passport-data':\s*\{[\s\S]*?aspectRatio: PASSPORT_ASPECT_RATIO,[\s\S]*?captureOrientation: 'landscape',[\s\S]*?Datenseite quer in den Rahmen halten\./,
  );
  assert.equal(
    (
      script.match(
        /Handy waagerecht halten\. (?:Personalausweis|Krankenkassenkarte|Ausweis) quer in den Rahmen halten\./g,
      ) ?? []
    ).length,
    6,
  );
  assert.doesNotMatch(script, /PORTRAIT_GUIDE_|ID_CARD_GUIDE_|guideOutline/);
  assert.match(
    script,
    /elements\.idGuide\.classList\.toggle\('is-passport', passport\)/,
  );
  assert.match(
    script,
    /elements\.preview\.parentElement\.classList\.toggle\('is-passport', passport\)/,
  );
  assert.match(
    script,
    /const portraitGuide = activeProfile\(\)\.captureOrientation === 'portrait'/,
  );
  assert.match(script, /portraitGuide \? 'portrait' : 'landscape'/);
  assert.doesNotMatch(script, /mapBoxToSource/);
  assert.match(
    script,
    /if \(portraitGuide\)[\s\S]+?drawPortraitCropAsLandscape/,
  );
  assert.doesNotMatch(
    script,
    /guideQuadInRect|guideQuadInSource|drawPerspectiveQuadAsRectangle/,
  );
  assert.match(script, /else \{[\s\S]+?context\.drawImage\(/);
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
  assert.match(script, /scanner-core\.js\?v=20261015-compact-qr-v29/);
  assert.match(
    script,
    /document-recognizer-core\.js\?v=20261014-document-allowlist-v26/,
  );
  assert.match(
    script,
    /document-recognizer\.js\?v=20261014-document-allowlist-v26/,
  );
  assert.match(script, /relay-client\.js\?v=20261015-compact-qr-v29/);
  assert.match(script, /recognizeDocumentCanvas\(canvas, capturedSlot\)/);
  assert.match(script, /recognizeDocumentCanvas\(canvas, 'tax-id'\)/);
  assert.match(script, /cancelDocumentRecognition/);
  assert.match(
    script,
    /resetLiveDocumentRecognition\(\{ cancelPending: true \}\)/,
  );
  assert.match(script, /function stopCamera\(\) \{[\s\S]+?stopAnalysis\(\);/);
  assert.match(
    script,
    /async function captureAutomatically\(\)[\s\S]+?stopAnalysis\(\{ cancelRecognition: false \}\)/,
  );
  assert.match(script, /documentVisualFingerprintsMatch\(/);
  assert.match(script, /Bitte stillhalten\. Dokument wird geprüft/);
  assert.match(script, /callRelayWithRecovery\(/);
  assert.match(script, /'claim'[\s\S]+?shouldContinue: \(\) => !sessionClosed/);
  assert.match(script, /elements\.documentFinish\.hidden = false/);
  assert.match(
    script,
    /open: 'Auswählbar',[\s\S]+?selected: 'Offen',[\s\S]+?'in-progress': 'Offen',[\s\S]+?complete: 'Abgeschlossen'/,
  );
  assert.match(script, /function submitTypedTaxId\(event\)/);
  assert.match(script, /isPlausibleTaxId\(normalized\)/);
  assert.match(script, /function normalizeTaxIdPhoto\(file\)/);
  assert.match(script, /documentSetVersion/);
  assert.match(script, /uploadChunksConcurrently\(/);
  assert.match(script, /const UPLOAD_CONCURRENCY = 4/);
  assert.match(script, /maxConcurrency:\s*UPLOAD_CONCURRENCY/);
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
  assert.match(script, /deriveCompactStaticPairing\(/);
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
    /async function finishDocumentSession\(\)[\s\S]+?pendingConfirm[\s\S]+?state !== 'dashboard'[\s\S]+?canCompleteDocumentSession\(completedSlots\)[\s\S]+?await confirmCompletedSession\(\)[\s\S]+?completeSession\(true\)/,
  );
  assert.doesNotMatch(
    script,
    /planStep\.kind === 'confirm'[\s\S]+?await confirmCompletedSession\(\)/,
  );
  assert.match(script, /showDashboard\(\)/);
  assert.match(
    script,
    /parsedBootstrap\.version === '2'[\s\S]+?parsedBootstrap\.version === '4'[\s\S]+?documentSetVersion =\s*parsedBootstrap\.version === '3' \|\| parsedBootstrap\.version === '4'[\s\S]+?showDashboard\(\)[\s\S]+?await resolveScannerBootstrap\(parsedBootstrap\)/,
  );
  assert.match(
    script,
    /function startDocument\(documentId, pressedCard = null\)[\s\S]+?selectedDocumentIds\.add\(documentId\)[\s\S]+?classList\.add\('is-activating'\)[\s\S]+?requestAnimationFrame\(\(\) => \{[\s\S]+?requestAnimationFrame\(\(\) => \{[\s\S]+?openDocument\(documentId\)/,
  );
  assert.match(
    script,
    /if \(firstSlot !== 'tax-id'\) void requestLandscapeCameraPresentation\(\)/,
  );
  assert.match(
    script,
    /function unlockScreenOrientation\(\)[\s\S]+?screen\?\.orientation\?\.unlock\?\.\(\)/,
  );
  assert.match(
    script,
    /function showDashboard\(direction = 'forward'\)[\s\S]+?stopCamera\(\);[\s\S]+?unlockScreenOrientation\(\)/,
  );
  const openDocumentStart = script.indexOf('function openDocument(documentId)');
  const startDocumentStart = script.indexOf(
    'function startDocument(documentId, pressedCard = null)',
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
  assert.match(script, /else startDocument\(card\.dataset\.document, card\)/);
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
  assert.match(script, /const completedCapturePreviews = new Map\(\)/);
  assert.match(
    script,
    /await transferPreparedPayload\(retryPayload\);[\s\S]+?rememberCompletedCapturePreview\(finalizedSide\);[\s\S]+?advanceAfterFinalizedDocumentSlot\(finalizedSide\)/,
  );
  assert.match(
    script,
    /function rememberCompletedCapturePreview\(slot\)[\s\S]+?URL\.createObjectURL\(acceptedCapture\.blob\)/,
  );
  assert.match(
    script,
    /function clearCompletedCapturePreviews\(\)[\s\S]+?URL\.revokeObjectURL\(preview\.url\)[\s\S]+?completedCapturePreviews\.clear\(\)/,
  );
  assert.match(
    script,
    /function disposeSensitiveState\(\)[\s\S]+?clearCompletedCapturePreviews\(\)/,
  );
  assert.match(
    script,
    /scanStatus === 'complete'[\s\S]+?hasCompletedDocumentPreview\(documentDefinition\)[\s\S]+?showCompletedDocumentPreview\(documentDefinition\)/,
  );
  assert.match(
    script,
    /const previewAvailable =\s*scanStatus === 'complete'[\s\S]+?hasCompletedDocumentPreview\(documentDefinition\)[\s\S]+?scanStatus === 'complete'[\s\S]+?\? !previewAvailable/,
  );
  assert.match(script, /\(busy && !sessionClosed\)/);
  const completeSessionStart = script.indexOf(
    'function completeSession(returnToDashboard = false)',
  );
  const resolveBootstrapStart = script.indexOf(
    'async function resolveScannerBootstrap',
    completeSessionStart,
  );
  const completeSessionSource = script.slice(
    completeSessionStart,
    resolveBootstrapStart,
  );
  assert.ok(
    completeSessionStart >= 0 && resolveBootstrapStart > completeSessionStart,
  );
  assert.doesNotMatch(completeSessionSource, /clearCompletedCapturePreviews/);
  assert.match(completeSessionSource, /state = 'dashboard-complete'/);
  assert.match(
    completeSessionSource,
    /if \(returnToDashboard\) \{[\s\S]+?unlockScreenOrientation\(\)/,
  );
  assert.match(script, /documentSlotLabel\(slot\)/);
  assert.match(script, /event\.key === 'Escape'/);
  assert.match(
    script,
    /elements\.documentPreview\.inert = true;[\s\S]+?setAttribute\('aria-hidden', 'true'\)/,
  );
  assert.match(
    script,
    /elements\.documentPreview\.inert = false;[\s\S]+?removeAttribute\('aria-hidden'\)/,
  );
  assert.match(script, /acceptedCapture = result;[\s\S]{0,250}stopCamera\(\)/);
  assert.match(script, /visibilitychange/);
  assert.match(script, /function animateViewIn\(/);
  assert.match(script, /prefersReducedMotion\(\)/);
  assert.match(
    script,
    /torchEnabled = requested;[\s\S]+?torchPending = true;[\s\S]+?updateTorchUi\(\);[\s\S]+?await track\.applyConstraints/,
  );
  assert.match(script, /document\.addEventListener\([\s\S]+?'pointerdown'/);
  assert.match(script, /classList\.add\('is-pressing'\)/);
  assert.match(
    script,
    /event\.key === 'Enter'[\s\S]+?event\.preventDefault\(\)[\s\S]+?requestAnimationFrame\([\s\S]+?button\.click\(\)/,
  );
  assert.match(
    script,
    /visibilitychange[\s\S]+?document\.visibilityState === 'hidden'[\s\S]+?stopCamera\(\)[\s\S]+?setCameraMessage\(\s*'Kamera wird geöffnet …',[\s\S]+?void requestCamera\(\)/,
  );
  assert.doesNotMatch(
    script,
    /visibilitychange[\s\S]+?Bitte Kamera erneut öffnen[\s\S]+?startCamera\.hidden = false/,
  );
  assert.match(script, /pagehide/);
  assert.match(
    styles,
    /\.id-guide\s*\{[\s\S]*?aspect-ratio:\s*85\.6\s*\/\s*53\.98/,
  );
  assert.match(
    styles,
    /\.id-guide\.is-passport\s*\{[\s\S]*?aspect-ratio:\s*125\s*\/\s*88/,
  );
  assert.match(
    styles,
    /\.id-guide\s*\{[\s\S]*?border:\s*3px solid color-mix\([\s\S]*?border-radius:\s*17px/,
  );
  assert.match(
    styles,
    /\.corner\s*\{[\s\S]*?width:\s*36px[\s\S]*?height:\s*36px[\s\S]*?border-color:\s*var\(--guide-color\)/,
  );
  assert.match(
    styles,
    /\.corner\.top-left\s*\{[\s\S]*?border-width:\s*6px 0 0 6px/,
  );
  assert.match(
    styles,
    /\.corner\.top-right\s*\{[\s\S]*?border-width:\s*6px 6px 0 0/,
  );
  assert.match(
    styles,
    /\.corner\.bottom-left\s*\{[\s\S]*?border-width:\s*0 0 6px 6px/,
  );
  assert.match(
    styles,
    /\.corner\.bottom-right\s*\{[\s\S]*?border-width:\s*0 6px 6px 0/,
  );
  assert.match(
    styles,
    /\.id-guide\.is-capture\s*\{[\s\S]*?border-color:\s*#fff/,
  );
  assert.doesNotMatch(styles, /guide-outline|<polygon/);
  assert.doesNotMatch(styles, /guide-introduction|guide-hint|is-introducing/);
  assert.doesNotMatch(script, /GuideIntroduction|is-introducing/);
  assert.match(styles, /\.document-status\.is-in-progress/);
  assert.match(styles, /\.document-card\.is-selected/);
  assert.match(styles, /\.document-preview-grid\s*\{[\s\S]+?repeat\(2,/);
  assert.match(styles, /\.document-preview-thumbnail/);
  assert.match(
    styles,
    /#image-preview-image\s*\{[\s\S]+?object-fit:\s*contain/,
  );
  assert.match(
    styles,
    /\.document-card:focus-visible,[\s\S]+?\.primary:focus-visible,[\s\S]+?\.secondary:focus-visible,[\s\S]+?\.tax-id-back:focus-visible/,
  );
  assert.match(
    styles,
    /#dashboard-title:focus,[\s\S]+?#complete:focus\s*\{[\s\S]+?outline:\s*none/,
  );
  assert.match(
    styles,
    /\.document-card\.is-pressing,[\s\S]+?\.document-card\.is-activating\s*\{[\s\S]+?scale:\s*0\.975[\s\S]+?translate:\s*0 1px[\s\S]+?0 0 0 3px/,
  );
  assert.match(
    styles,
    /\.primary\.is-pressing,[\s\S]+?\.tax-id-back\.is-pressing\s*\{[\s\S]+?scale:\s*0\.975/,
  );
  assert.match(
    styles,
    /\.camera-action\.is-pressing\s*\{[\s\S]+?scale:\s*0\.965/,
  );
  assert.match(styles, /\.torch-toggle\.is-pending/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]+?animation-duration:\s*0\.01ms !important[\s\S]+?transition-duration:\s*0\.01ms !important/,
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
  assert.match(guideRule, /width:\s*min\(94dvw,\s*140dvh,\s*1100px\)/);
  assert.match(guideRule, /top:\s*49%/);
  assert.doesNotMatch(guideRule, /aspect-ratio:\s*53\.98\s*\/\s*85\.6/);
  const orientationRule = styles.match(
    /\.guide-orientation\s*\{([\s\S]*?)\}/,
  )?.[1];
  assert.ok(orientationRule);
  assert.match(orientationRule, /top:\s*1%/);
  assert.match(orientationRule, /right:\s*auto/);
  assert.match(orientationRule, /left:\s*50%/);
  assert.match(orientationRule, /translate\(-50%,\s*-50%\)/);
  assert.doesNotMatch(orientationRule, /rotate\(/);
  assert.doesNotMatch(styles, /\.id-guide\.is-passport \.guide-orientation/);
  const previewRule = styles.match(/#preview\s*\{([\s\S]*?)\}/)?.[1];
  assert.ok(previewRule);
  assert.match(previewRule, /width:\s*100%/);
  assert.match(previewRule, /height:\s*100%/);
  assert.match(previewRule, /object-fit:\s*cover/);
  assert.doesNotMatch(previewRule, /rotate\(90deg\)/);
  assert.match(
    styles,
    /\.preview-frame\.is-passport\s*\{[\s\S]*?aspect-ratio:\s*125\s*\/\s*88/,
  );
  assert.doesNotMatch(
    styles,
    /\.preview-frame\.is-passport #preview\s*\{[\s\S]*?rotate\(/,
  );
  const previewFrameRule = styles.match(
    /\.preview-frame\s*\{([\s\S]*?)\}/,
  )?.[1];
  assert.ok(previewFrameRule);
  assert.doesNotMatch(previewFrameRule, /border:\s*3px/);
  assert.match(previewFrameRule, /width:\s*min\(88vw,\s*54vh,\s*430px\)/);
  assert.match(previewFrameRule, /width:\s*min\(88vw,\s*54dvh,\s*430px\)/);
  assert.match(previewFrameRule, /aspect-ratio:\s*85\.6\s*\/\s*53\.98/);
  assert.match(
    styles,
    /\.preview-frame::after\s*\{[\s\S]+?inset:\s*0[\s\S]+?border:\s*3px solid #24d28c/,
  );
  assert.match(
    styles,
    /@media \(orientation: landscape\)[\s\S]+?\.id-guide\s*\{[\s\S]+?width:\s*min\(94dvw,\s*140dvh,\s*1100px\)[\s\S]+?\.preview-frame\s*\{[\s\S]+?width:\s*min\(74vw,\s*70dvh,\s*380px\)/,
  );
  assert.match(
    styles,
    /\.camera-stage\.needs-landscape \.id-guide,[\s\S]+?visibility:\s*hidden;[\s\S]+?opacity:\s*0/,
  );
  assert.match(styles, /\.rotate-phone\s*\{[\s\S]+?top:\s*50%/);
  assert.match(
    styles,
    /@media \(orientation: landscape\)[\s\S]+?\.camera-copy\s*\{[\s\S]+?left:\s*calc\(50% \+ min\(47dvw,\s*70dvh,\s*550px\) \+ 8px\)[\s\S]+?transform:\s*translateY\(-50%\)/,
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
  assert.match(
    headers['Content-Security-Policy'],
    /script-src 'self' 'wasm-unsafe-eval'/,
  );
  assert.match(headers['Content-Security-Policy'], /worker-src 'self'/);
  assert.equal(firebase.hosting.headers[1].source, '/ocr-v1/**');
  assert.equal(
    firebase.hosting.headers[1].headers.find(
      ({ key }) => key === 'Cache-Control',
    )?.value,
    'public, max-age=31536000, immutable',
  );
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
  const documentRecognizerCoreUrl = new URL(
    'document-recognizer-core.js',
    directory,
  ).href;
  const documentRecognizerStubUrl = `data:text/javascript;base64,${Buffer.from(`
export function warmDocumentRecognizer() { return Promise.resolve(true); }
export function recognizeDocumentCanvas() {
  return Promise.resolve({ accepted: false, reason: 'test stub' });
}
export function cancelDocumentRecognition() { return Promise.resolve(); }
export function disposeDocumentRecognizer() { return Promise.resolve(); }
`).toString('base64')}`;
  const relayClientUrl = new URL('relay-client.js', directory).href;
  const source = await readFile(scannerUrl, 'utf8');
  const instrumentedSource = source
    .replace(
      "from './scanner-core.js?v=20261015-compact-qr-v29';",
      `from ${JSON.stringify(scannerCoreUrl)};`,
    )
    .replace(
      "from './document-recognizer-core.js?v=20261014-document-allowlist-v26';",
      `from ${JSON.stringify(documentRecognizerCoreUrl)};`,
    )
    .replace(
      "from './document-recognizer.js?v=20261014-document-allowlist-v26';",
      `from ${JSON.stringify(documentRecognizerStubUrl)};`,
    )
    .replace(
      "from './relay-client.js?v=20261015-compact-qr-v29';",
      `from ${JSON.stringify(relayClientUrl)};`,
    )
    .replace(
      /\n(?:if \(!window\.__SN_SCANNER_REDIRECTING__\) )?void start\(\);\s*$/,
      `
export {
  advanceAfterFinalizedDocumentSlot,
  backToDashboard,
  phoneViewportIsLandscape,
  requestCamera,
  resetTorchState,
  setTorch,
  startDocument,
  stopCamera,
  updatePhoneOrientation,
};
export function prepareOrientationLifecycleTest() {
  sessionClaimed = true;
  sessionClosed = false;
  state = 'scanning';
  elements.cameraStage.hidden = false;
  elements.countdown.textContent = '3';
  clearLandscapeRequirement();
}
export function orientationLifecycleState() {
  return {
    landscape: phoneViewportIsLandscape(),
    needsLandscape: elements.cameraStage.classList.contains('needs-landscape'),
    promptHidden: elements.rotatePhone.hidden,
    countdown: elements.countdown.textContent,
  };
}
export function prepareDashboardLifecycleTest() {
  protocolVersion = '2';
  captureMode = 'documents-v2';
  sessionClaimed = true;
  sessionClosed = false;
  pendingConfirm = false;
  busy = false;
  selectionLocked = false;
  selectedDocumentIds.clear();
  completedSlots.clear();
  elements.dashboard.hidden = false;
  elements.complete.hidden = true;
  state = 'dashboard';
  renderDashboard();
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
export function prepareTorchLifecycleTest(track, enabled = false) {
  torchOperationId += 1;
  activeVideoTrack = track;
  torchSupported = true;
  torchEnabled = enabled;
  torchPending = false;
  updateTorchUi();
}
export function torchLifecycleState() {
  return {
    enabled: torchEnabled,
    pending: torchPending,
    hidden: elements.torchToggle.hidden,
    disabled: elements.torchToggle.disabled,
    text: elements.torchToggle.textContent,
    isOn: elements.torchToggle.classList.contains('is-on'),
    isPending: elements.torchToggle.classList.contains('is-pending'),
    ariaPressed: elements.torchToggle.attributes.get('aria-pressed'),
    ariaBusy: elements.torchToggle.attributes.get('aria-busy'),
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
      'screen',
      'window',
    ].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  const defineGlobal = (name, value) =>
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  const classList = () => {
    const names = new Set();
    return {
      add(...items) {
        for (const item of items) names.add(item);
      },
      remove(...items) {
        for (const item of items) names.delete(item);
      },
      toggle(name, force) {
        const enabled = force === undefined ? !names.has(name) : Boolean(force);
        if (enabled) names.add(name);
        else names.delete(name);
        return enabled;
      },
      contains(name) {
        return names.has(name);
      },
    };
  };
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      const attributes = new Map();
      const value = {
        attributes,
        checked: false,
        classList: classList(),
        disabled: false,
        firstElementChild: { style: {} },
        focus() {},
        hidden: false,
        parentElement: { classList: classList() },
        pause() {},
        removeAttribute(name) {
          attributes.delete(name);
        },
        removeEventListener() {},
        setAttribute(name, value) {
          attributes.set(name, String(value));
        },
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
    let reject;
    const promise = new Promise((next, fail) => {
      resolve = next;
      reject = fail;
    });
    return { promise, reject, resolve };
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
  let orientationLockCalls = 0;
  let orientationUnlockCalls = 0;
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
    defineGlobal('innerHeight', 390);
    defineGlobal('innerWidth', 844);
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
    defineGlobal('screen', {
      orientation: {
        async lock(mode) {
          assert.equal(mode, 'landscape');
          orientationLockCalls += 1;
        },
        unlock() {
          orientationUnlockCalls += 1;
        },
      },
    });

    scanner = await import(
      `data:text/javascript;base64,${Buffer.from(instrumentedSource).toString('base64')}`
    );
    const firstStream = createStream();
    const secondStream = createStream();

    scanner.prepareOrientationLifecycleTest();
    assert.equal(scanner.phoneViewportIsLandscape(), true);
    defineGlobal('innerHeight', 844);
    defineGlobal('innerWidth', 390);
    assert.equal(scanner.updatePhoneOrientation(), false);
    assert.deepEqual(scanner.orientationLifecycleState(), {
      landscape: false,
      needsLandscape: true,
      promptHidden: false,
      countdown: '',
    });
    defineGlobal('innerHeight', 390);
    defineGlobal('innerWidth', 844);
    assert.equal(scanner.updatePhoneOrientation(), true);
    assert.deepEqual(scanner.orientationLifecycleState(), {
      landscape: true,
      needsLandscape: false,
      promptHidden: true,
      countdown: '',
    });

    scanner.prepareDashboardLifecycleTest();
    assert.deepEqual(scanner.documentLifecycleState(), {
      state: 'dashboard',
      sessionClosed: false,
      pendingConfirm: false,
      selectionLocked: false,
      selectedDocumentIds: [],
      completedSlots: [],
      dashboardHidden: false,
      completeHidden: true,
      finishHidden: false,
      finishDisabled: true,
    });
    scanner.startDocument('identity-card');
    const firstResult = scanner.cameraLifecycleState().cameraPromise;
    assert.equal(orientationLockCalls, 1);
    scanner.backToDashboard();
    assert.equal(
      orientationUnlockCalls,
      1,
      'returning to the overview must release the landscape lock',
    );
    scanner.startDocument('passport');
    assert.equal(
      orientationLockCalls,
      2,
      'opening another document must lock the scanner to landscape again',
    );
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
    const unlocksBeforeCompletedDocument = orientationUnlockCalls;
    scanner.advanceAfterFinalizedDocumentSlot('id-back');
    assert.equal(
      orientationUnlockCalls,
      unlocksBeforeCompletedDocument + 1,
      'finishing a document must restore automatic overview rotation',
    );
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
      finishDisabled: true,
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

    const torchActivation = deferred();
    let torchConstraintCalls = 0;
    const torchTrack = {
      applyConstraints() {
        torchConstraintCalls += 1;
        return torchActivation.promise;
      },
    };
    scanner.prepareTorchLifecycleTest(torchTrack);
    const torchResult = scanner.setTorch(true);
    assert.deepEqual(scanner.torchLifecycleState(), {
      enabled: true,
      pending: true,
      hidden: false,
      disabled: true,
      text: 'Licht aus',
      isOn: true,
      isPending: true,
      ariaPressed: 'true',
      ariaBusy: 'true',
    });
    assert.equal(torchConstraintCalls, 1);
    assert.equal(await scanner.setTorch(false), false);
    assert.equal(
      torchConstraintCalls,
      1,
      'pending torch changes are serialized',
    );
    torchActivation.resolve();
    assert.equal(await torchResult, true);
    assert.deepEqual(scanner.torchLifecycleState(), {
      enabled: true,
      pending: false,
      hidden: false,
      disabled: false,
      text: 'Licht aus',
      isOn: true,
      isPending: false,
      ariaPressed: 'true',
      ariaBusy: undefined,
    });

    const torchFailure = deferred();
    const failingTrack = {
      applyConstraints() {
        return torchFailure.promise;
      },
    };
    scanner.prepareTorchLifecycleTest(failingTrack);
    const failedTorchResult = scanner.setTorch(true);
    assert.equal(scanner.torchLifecycleState().text, 'Licht aus');
    torchFailure.reject(new Error('camera driver rejected torch'));
    assert.equal(await failedTorchResult, false);
    assert.deepEqual(scanner.torchLifecycleState(), {
      enabled: false,
      pending: false,
      hidden: false,
      disabled: false,
      text: 'Licht an',
      isOn: false,
      isPending: false,
      ariaPressed: 'false',
      ariaBusy: undefined,
    });

    const torchDeactivation = deferred();
    const deactivationTrack = {
      applyConstraints() {
        return torchDeactivation.promise;
      },
    };
    scanner.prepareTorchLifecycleTest(deactivationTrack, true);
    const deactivationResult = scanner.setTorch(false);
    assert.deepEqual(scanner.torchLifecycleState(), {
      enabled: false,
      pending: true,
      hidden: false,
      disabled: true,
      text: 'Licht an',
      isOn: false,
      isPending: true,
      ariaPressed: 'false',
      ariaBusy: 'true',
    });
    torchDeactivation.reject(new Error('camera driver rejected torch off'));
    assert.equal(await deactivationResult, false);
    assert.deepEqual(scanner.torchLifecycleState(), {
      enabled: true,
      pending: false,
      hidden: false,
      disabled: false,
      text: 'Licht aus',
      isOn: true,
      isPending: false,
      ariaPressed: 'true',
      ariaBusy: undefined,
    });

    const staleTorch = deferred();
    let staleConstraintCalls = 0;
    const staleTrack = {
      applyConstraints() {
        staleConstraintCalls += 1;
        return staleConstraintCalls === 1
          ? staleTorch.promise
          : Promise.resolve();
      },
    };
    scanner.prepareTorchLifecycleTest(staleTrack);
    const staleTorchResult = scanner.setTorch(true);
    scanner.resetTorchState();
    staleTorch.resolve();
    assert.equal(await staleTorchResult, false);
    assert.deepEqual(scanner.torchLifecycleState(), {
      enabled: false,
      pending: false,
      hidden: true,
      disabled: false,
      text: 'Licht an',
      isOn: false,
      isPending: false,
      ariaPressed: 'false',
      ariaBusy: undefined,
    });
  } finally {
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
