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
  isPlausibleTaxId,
  nextDocumentSlot,
  nextSelectedPlanStep,
  normalizeTaxId,
  normalizedIdCrop,
  parseDiscoveredScannerBootstrap,
  parseScannerBootstrap,
  PASSPORT_ASPECT_RATIO,
  portraitCaptureLayout,
  scannerDocumentsForVersion,
  updateHoldState,
} from './scanner-core.js?v=20261009-clean-directory-v11';
import {
  callRelayWithOneRetry,
  createPhoneSession,
  decryptStaticBootstrap,
  disposePreparedCapture,
  importCaptureKey,
  importStaticPairingKey,
  prepareEncryptedCapture,
  RelayError,
  uploadChunksConcurrently,
  waitForStaticSession,
} from './relay-client.js?v=20261009-clean-directory-v11';

const MAX_FINALIZE_ATTEMPTS = 5;
const LIVE_ANALYSIS_INTERVAL_MS = 145;
const MAX_LIVE_ANALYSIS_EDGE = 480;
const MAX_CAPTURE_LONG_EDGE = 2_400;
const VIDEO_FALLBACK_MIN_LONG_EDGE = 640;
const VIDEO_FALLBACK_MIN_SHORT_EDGE = 400;
const VIDEO_FALLBACK_MIN_SHARPNESS = 12;
const VIDEO_FALLBACK_OUTPUT_LONG_EDGE = 1_600;
const CAPTURE_VIBRATION_PATTERN = [80, 40, 120];
const TAX_ID_PAGE_WIDTH = 1_400;
const TAX_ID_PAGE_HEIGHT = 1_980;

const elements = Object.fromEntries(
  [
    'app',
    'loading',
    'dashboard',
    'dashboard-title',
    'document-list',
    'document-finish',
    'finish-session',
    'dashboard-status',
    'tax-id-card',
    'tax-id-stage',
    'tax-id-title',
    'tax-id-back',
    'tax-id-methods',
    'tax-id-type',
    'tax-id-photo',
    'tax-id-form',
    'tax-id-input',
    'tax-id-error',
    'tax-id-submit',
    'tax-id-photo-input',
    'camera-stage',
    'camera',
    'id-guide',
    'countdown',
    'side-label',
    'camera-status',
    'start-camera',
    'back-to-dashboard',
    'torch-toggle',
    'review',
    'review-title',
    'preview',
    'consent',
    'consent-label',
    'use-capture',
    'repeat-capture',
    'upload-progress',
    'review-status',
    'fatal',
    'fatal-message',
    'complete',
    'analysis-canvas',
    'capture-canvas',
  ].map((id) => [
    id.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()),
    document.getElementById(id),
  ]),
);

let endpoint = '';
let sessionId = '';
let phoneSession = '';
let encryptionKey = null;
let sessionClaimed = false;
let sessionClosed = false;
let protocolVersion = '1';
let captureMode = 'identity-v1';
let documentSetVersion = 2;
let side = 'front';
const completedSlots = new Set();
const selectedDocumentIds = new Set();
let selectionLocked = false;
let state = 'starting';
let mediaStream = null;
let mediaStreamRequest = null;
let activeVideoTrack = null;
let torchSupported = false;
let torchEnabled = false;
let cameraRequest = null;
let cameraGeneration = 0;
let analysisGeneration = 0;
let analysisFrame = 0;
let lastAnalysisAt = 0;
let holdState = createHoldState();
let lastPositionedBox = null;
let acceptedCapture = null;
let previewUrl = '';
let retryPayload = null;
let pendingConfirm = false;
let busy = false;
let expiryTimer = 0;
let captureFeedbackTimer = 0;

const SLOT_PROFILES = Object.freeze({
  front: {
    title: 'Vorderseite Personalausweis',
    aspectRatio: ID_CARD_ASPECT_RATIO,
    instruction: 'Ausweis hochkant in den Rahmen halten.',
  },
  back: {
    title: 'Rückseite Personalausweis',
    aspectRatio: ID_CARD_ASPECT_RATIO,
    instruction: 'Ausweis hochkant in den Rahmen halten.',
  },
  'id-front': {
    title: 'Vorderseite Personalausweis',
    aspectRatio: ID_CARD_ASPECT_RATIO,
    instruction: 'Personalausweis hochkant in den Rahmen halten.',
  },
  'id-back': {
    title: 'Rückseite Personalausweis',
    aspectRatio: ID_CARD_ASPECT_RATIO,
    instruction: 'Personalausweis hochkant in den Rahmen halten.',
  },
  'passport-data': {
    title: 'Datenseite Reisepass',
    aspectRatio: PASSPORT_ASPECT_RATIO,
    instruction: 'Datenseite hochkant in den Rahmen halten.',
  },
  'health-front': {
    title: 'Vorderseite Krankenkassenkarte',
    aspectRatio: ID_CARD_ASPECT_RATIO,
    instruction: 'Krankenkassenkarte hochkant in den Rahmen halten.',
  },
  'health-back': {
    title: 'Rückseite Krankenkassenkarte',
    aspectRatio: ID_CARD_ASPECT_RATIO,
    instruction: 'Krankenkassenkarte hochkant in den Rahmen halten.',
  },
  'tax-id': {
    title: 'Steueridentifikationsnummer',
    aspectRatio: TAX_ID_PAGE_WIDTH / TAX_ID_PAGE_HEIGHT,
    instruction:
      'Nur den Bereich mit der Steueridentifikationsnummer fotografieren.',
  },
});

function availableDocuments() {
  return scannerDocumentsForVersion(documentSetVersion);
}

function activeProfile() {
  return SLOT_PROFILES[side] || SLOT_PROFILES.front;
}

function sideTitle() {
  return activeProfile().title;
}

function applyProfileVisuals() {
  const passport = activeProfile().aspectRatio === PASSPORT_ASPECT_RATIO;
  const taxId = side === 'tax-id';
  elements.idGuide.classList.toggle('is-passport', passport);
  elements.preview.parentElement.classList.toggle('is-passport', passport);
  elements.preview.parentElement.classList.toggle('is-tax-id', taxId);
  elements.sideLabel.textContent = sideTitle();
  elements.reviewTitle.textContent = sideTitle();
}

function setCameraMessage(instruction, status = '') {
  elements.sideLabel.textContent = sideTitle();
  elements.cameraStatus.textContent = status || instruction;
}

function setGuide(valid) {
  window.clearTimeout(captureFeedbackTimer);
  captureFeedbackTimer = 0;
  elements.idGuide.classList.remove('is-capture');
  elements.idGuide.classList.toggle('is-green', valid);
  elements.idGuide.classList.toggle('is-red', !valid);
}

function setProgress(percent) {
  elements.uploadProgress.firstElementChild.style.width = `${Math.max(
    0,
    Math.min(100, percent),
  )}%`;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function triggerCaptureFeedback() {
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(CAPTURE_VIBRATION_PATTERN);
    }
  } catch {
    // Vibration is optional and is not available in every mobile browser.
  }
  elements.idGuide.classList.add('is-capture');
  captureFeedbackTimer = window.setTimeout(() => {
    captureFeedbackTimer = 0;
    elements.idGuide.classList.remove('is-capture');
  }, 320);
}

function updateTorchUi() {
  const visible = torchSupported && Boolean(activeVideoTrack);
  elements.torchToggle.hidden = !visible;
  elements.torchToggle.classList.toggle('is-on', visible && torchEnabled);
  elements.torchToggle.setAttribute(
    'aria-pressed',
    String(visible && torchEnabled),
  );
  elements.torchToggle.textContent = torchEnabled ? 'Licht aus' : 'Licht an';
}

async function setTorch(enabled) {
  if (!activeVideoTrack || !torchSupported) return false;
  try {
    await activeVideoTrack.applyConstraints({
      advanced: [{ torch: Boolean(enabled) }],
    });
    torchEnabled = Boolean(enabled);
    updateTorchUi();
    return true;
  } catch {
    torchEnabled = false;
    torchSupported = false;
    updateTorchUi();
    return false;
  }
}

function resetTorchState() {
  if (activeVideoTrack && torchEnabled) {
    void activeVideoTrack
      .applyConstraints({ advanced: [{ torch: false }] })
      .catch(() => {});
  }
  torchEnabled = false;
  torchSupported = false;
  activeVideoTrack = null;
  updateTorchUi();
}

function stopAnalysis() {
  analysisGeneration += 1;
  cancelAnimationFrame(analysisFrame);
  analysisFrame = 0;
  elements.countdown.textContent = '';
}

function stopStreamTracks(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

function releaseCameraStream(stream, request) {
  if (!stream) return;
  if (mediaStream === stream && mediaStreamRequest !== request) {
    // A newer request may receive the same browser-managed stream object.
    // The stale request must not tear down its successor's active camera.
    return;
  }
  if (mediaStream === stream) {
    mediaStream = null;
    mediaStreamRequest = null;
    resetTorchState();
    if (elements.camera.srcObject === stream) {
      elements.camera.pause();
      elements.camera.srcObject = null;
    }
  }
  stopStreamTracks(stream);
}

function stopCamera() {
  stopAnalysis();
  cameraGeneration += 1;
  cameraRequest = null;
  const stream = mediaStream;
  mediaStream = null;
  mediaStreamRequest = null;
  resetTorchState();
  stopStreamTracks(stream);
  elements.camera.pause();
  elements.camera.srcObject = null;
}

function clearPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = '';
  elements.preview.removeAttribute('src');
}

function clearAcceptedCapture() {
  if (acceptedCapture?.bytes) acceptedCapture.bytes.fill(0);
  acceptedCapture = null;
  clearPreview();
  elements.consent.checked = false;
}

function clearRetryPayload() {
  if (!retryPayload) return;
  disposePreparedCapture(retryPayload);
  retryPayload = null;
}

function disposeSensitiveState() {
  sessionClosed = true;
  clearTimeout(expiryTimer);
  expiryTimer = 0;
  stopCamera();
  clearAcceptedCapture();
  clearRetryPayload();
  encryptionKey = null;
  phoneSession = '';
  sessionId = '';
  endpoint = '';
  pendingConfirm = false;
  completedSlots.clear();
  selectedDocumentIds.clear();
  selectionLocked = false;
  clearTaxIdEntry();
  elements.analysisCanvas.width = 0;
  elements.analysisCanvas.height = 0;
  elements.captureCanvas.width = 0;
  elements.captureCanvas.height = 0;
}

function fail(message) {
  if (!sessionClosed) disposeSensitiveState();
  state = 'fatal';
  elements.loading.hidden = true;
  elements.dashboard.hidden = true;
  elements.cameraStage.hidden = true;
  elements.review.hidden = true;
  elements.taxIdStage.hidden = true;
  elements.complete.hidden = true;
  elements.fatal.hidden = false;
  elements.fatalMessage.textContent = message;
  elements.app.setAttribute('aria-busy', 'false');
  elements.fatal.focus({ preventScroll: true });
}

function scheduleExpiry(expiresAt) {
  const expiry = Number(expiresAt);
  if (!Number.isSafeInteger(expiry) || expiry <= Date.now()) {
    throw new RelayError(
      'Die sichere Sitzung ist abgelaufen. Bitte am Laptop einen neuen QR-Code öffnen.',
      false,
      'expired',
    );
  }
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(
    () =>
      fail(
        'Die sichere Sitzung ist abgelaufen. Bitte am Laptop einen neuen QR-Code öffnen.',
      ),
    Math.min(2_147_000_000, Math.max(1, expiry - Date.now())),
  );
}

function cameraFailureMessage(error) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'Dieser Browser unterstützt den direkten Kamerazugriff nicht.';
  }
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return 'Bitte erlauben Sie den Kamerazugriff im Browser.';
  }
  if (error?.name === 'NotFoundError') {
    return 'Auf diesem Gerät wurde keine Kamera gefunden.';
  }
  if (error?.name === 'NotReadableError') {
    return 'Die Kamera wird bereits von einer anderen App verwendet.';
  }
  return 'Die Kamera konnte nicht geöffnet werden. Bitte erneut versuchen.';
}

async function waitForVideoMetadata(video) {
  if (video.readyState >= 1 && video.videoWidth && video.videoHeight) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Die Kamera liefert kein Bild.'));
    }, 8_000);
    const loaded = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error('Die Kamera liefert kein Bild.'));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('loadedmetadata', loaded);
      video.removeEventListener('error', failed);
    };
    video.addEventListener('loadedmetadata', loaded, { once: true });
    video.addEventListener('error', failed, { once: true });
  });
}

async function requestCamera() {
  if (sessionClosed) return false;
  if (mediaStream) {
    const liveTrack = mediaStream
      .getVideoTracks()
      .some((track) => track.readyState === 'live');
    if (liveTrack) return true;
    stopCamera();
  }
  if (cameraRequest) return cameraRequest.promise;
  const request = {
    generation: ++cameraGeneration,
    promise: null,
  };
  cameraRequest = request;
  elements.startCamera.hidden = true;
  setCameraMessage(
    'Kamera wird geöffnet …',
    'Beim ersten Mal bitte den Kamerazugriff bestätigen.',
  );
  request.promise = (async () => {
    let stream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException('getUserMedia fehlt', 'NotSupportedError');
      }
      const supportedConstraints =
        navigator.mediaDevices.getSupportedConstraints?.() ?? {};
      const videoConstraints = {
        facingMode: { ideal: 'environment' },
        width: { ideal: innerHeight >= innerWidth ? 2_160 : 3_840 },
        height: { ideal: innerHeight >= innerWidth ? 3_840 : 2_160 },
        frameRate: { ideal: 30 },
      };
      if (supportedConstraints.resizeMode) {
        videoConstraints.resizeMode = { ideal: 'none' };
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: videoConstraints,
      });
      if (
        cameraRequest !== request ||
        request.generation !== cameraGeneration ||
        sessionClosed
      ) {
        releaseCameraStream(stream, request);
        return false;
      }
      const track = stream.getVideoTracks()[0];
      const capabilities = track?.getCapabilities?.();
      if (capabilities?.focusMode?.includes?.('continuous')) {
        try {
          await track.applyConstraints({
            advanced: [{ focusMode: 'continuous' }],
          });
        } catch {
          // Continuous autofocus is an optional enhancement only.
        }
      }
      if (
        cameraRequest !== request ||
        request.generation !== cameraGeneration ||
        sessionClosed
      ) {
        releaseCameraStream(stream, request);
        return false;
      }
      mediaStream = stream;
      mediaStreamRequest = request;
      activeVideoTrack = track;
      torchSupported = capabilities?.torch === true;
      torchEnabled = false;
      updateTorchUi();
      elements.camera.srcObject = stream;
      await waitForVideoMetadata(elements.camera);
      if (
        cameraRequest !== request ||
        request.generation !== cameraGeneration ||
        sessionClosed ||
        mediaStream !== stream ||
        mediaStreamRequest !== request
      ) {
        releaseCameraStream(stream, request);
        return false;
      }
      await elements.camera.play();
      if (
        cameraRequest !== request ||
        request.generation !== cameraGeneration ||
        sessionClosed ||
        mediaStream !== stream ||
        mediaStreamRequest !== request
      ) {
        releaseCameraStream(stream, request);
        return false;
      }
      applyProfileVisuals();
      setCameraMessage(
        activeProfile().instruction,
        sessionClaimed
          ? 'Oberkante nach rechts. Der Rahmen wird bei passender Position grün.'
          : 'Sichere Sitzung wird vorbereitet …',
      );
      if (sessionClaimed) beginAnalysis();
      return true;
    } catch (error) {
      releaseCameraStream(stream, request);
      if (
        cameraRequest === request &&
        request.generation === cameraGeneration &&
        !sessionClosed
      ) {
        setGuide(false);
        setCameraMessage('Kamera wird benötigt.', cameraFailureMessage(error));
        elements.startCamera.hidden = false;
      }
      return false;
    } finally {
      if (cameraRequest === request) cameraRequest = null;
    }
  })();
  return request.promise;
}

function visibleFrame(canvas, source, sourceWidth, sourceHeight) {
  const stageRect = elements.cameraStage.getBoundingClientRect();
  const scale =
    MAX_LIVE_ANALYSIS_EDGE / Math.max(stageRect.width, stageRect.height);
  canvas.width = Math.max(3, Math.round(stageRect.width * scale));
  canvas.height = Math.max(3, Math.round(stageRect.height * scale));
  const crop = coverSourceRect(
    sourceWidth,
    sourceHeight,
    stageRect.width,
    stageRect.height,
  );
  const context = canvas.getContext('2d', {
    alpha: false,
    willReadFrequently: true,
  });
  context.drawImage(
    source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const guideClient = elements.idGuide.getBoundingClientRect();
  return {
    context,
    stageRect,
    sourceCrop: crop,
    guideRect: {
      x: ((guideClient.left - stageRect.left) / stageRect.width) * canvas.width,
      y: ((guideClient.top - stageRect.top) / stageRect.height) * canvas.height,
      width: (guideClient.width / stageRect.width) * canvas.width,
      height: (guideClient.height / stageRect.height) * canvas.height,
    },
  };
}

function beginAnalysis() {
  if (
    sessionClosed ||
    !sessionClaimed ||
    !mediaStream ||
    elements.camera.readyState < 2
  ) {
    return;
  }
  stopAnalysis();
  state = 'scanning';
  holdState = createHoldState();
  lastPositionedBox = null;
  lastAnalysisAt = 0;
  setGuide(false);
  applyProfileVisuals();
  setCameraMessage(
    activeProfile().instruction,
    'Oberkante nach rechts. Der Rahmen wird bei passender Position grün.',
  );
  const generation = analysisGeneration;
  const loop = (timestamp) => {
    if (
      generation !== analysisGeneration ||
      sessionClosed ||
      state !== 'scanning'
    ) {
      return;
    }
    if (timestamp - lastAnalysisAt >= LIVE_ANALYSIS_INTERVAL_MS) {
      lastAnalysisAt = timestamp;
      try {
        const frame = visibleFrame(
          elements.analysisCanvas,
          elements.camera,
          elements.camera.videoWidth,
          elements.camera.videoHeight,
        );
        const image = frame.context.getImageData(
          0,
          0,
          elements.analysisCanvas.width,
          elements.analysisCanvas.height,
        );
        const observation = analyzeFramePosition(image, frame.guideRect);
        image.data.fill(0);
        holdState = updateHoldState(holdState, observation, timestamp, {
          width: elements.analysisCanvas.width,
          height: elements.analysisCanvas.height,
        });
        if (observation.positioned) lastPositionedBox = observation.box;
        const visuallyValid = observation.positioned || holdState.holding;
        setGuide(visuallyValid);
        if (visuallyValid) {
          elements.sideLabel.textContent = sideTitle();
          elements.cameraStatus.textContent = `Bitte stillhalten · Aufnahme in ${Math.max(
            1,
            holdState.countdown,
          )} …`;
          elements.countdown.textContent = holdState.countdown || '';
        } else {
          elements.sideLabel.textContent = sideTitle();
          elements.cameraStatus.textContent =
            'Der Rahmen wird grün, sobald der Ausweis richtig liegt.';
          elements.countdown.textContent = '';
        }
        // `updateHoldState` keeps a short grace window for one noisy camera
        // frame.  Once the three seconds are complete, use the last stable
        // box even if this exact frame briefly failed edge detection; waiting
        // for another positioned frame was the source of late/missed shots.
        if (holdState.ready && lastPositionedBox) {
          void captureAutomatically();
          return;
        }
      } catch {
        setGuide(false);
        setCameraMessage(
          activeProfile().instruction,
          'Das Kamerabild wird vorbereitet …',
        );
      }
    }
    analysisFrame = requestAnimationFrame(loop);
  };
  analysisFrame = requestAnimationFrame(loop);
}

function captureVideoFrame() {
  const width = elements.camera.videoWidth;
  const height = elements.camera.videoHeight;
  if (!width || !height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    canvas.width = 0;
    canvas.height = 0;
    return null;
  }
  context.drawImage(elements.camera, 0, 0, width, height);
  return {
    source: canvas,
    width,
    height,
    close: () => {
      canvas.width = 0;
      canvas.height = 0;
    },
    kind: 'video',
  };
}

async function canvasToJpeg(canvas) {
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.94),
  );
  if (!blob) throw new Error('Die Aufnahme konnte nicht verarbeitet werden.');
  return { blob, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

function clearTaxIdEntry() {
  elements.taxIdInput.value = '';
  elements.taxIdInput.removeAttribute('aria-invalid');
  elements.taxIdError.textContent = '';
  elements.taxIdPhotoInput.value = '';
}

function showCaptureReview(result, consentCopy) {
  acceptedCapture = result;
  stopCamera();
  previewUrl = URL.createObjectURL(result.blob);
  elements.preview.src = previewUrl;
  elements.reviewTitle.textContent = sideTitle();
  elements.consentLabel.textContent = consentCopy;
  elements.consent.checked = false;
  elements.useCapture.disabled = true;
  elements.useCapture.textContent =
    side === 'tax-id' ? 'Nummer übernehmen' : 'Aufnahme verwenden';
  elements.repeatCapture.textContent =
    side === 'tax-id' ? 'Ändern' : 'Neu aufnehmen';
  elements.repeatCapture.disabled = false;
  elements.reviewStatus.textContent = '';
  elements.uploadProgress.hidden = true;
  elements.taxIdStage.hidden = true;
  elements.review.hidden = false;
  state = 'review';
  elements.app.setAttribute('aria-busy', 'false');
  elements.reviewTitle.focus({ preventScroll: true });
}

function taxIdDisplayValue(value) {
  return `${value.slice(0, 2)} ${value.slice(2, 5)} ${value.slice(
    5,
    8,
  )} ${value.slice(8)}`;
}

async function renderTypedTaxId(value) {
  const canvas = document.createElement('canvas');
  canvas.width = TAX_ID_PAGE_WIDTH;
  canvas.height = TAX_ID_PAGE_HEIGHT;
  try {
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#d8e0e2';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#07545a';
    context.fillRect(0, 0, canvas.width, 190);
    context.fillStyle = '#ffffff';
    context.font = '700 58px system-ui, sans-serif';
    context.fillText('SICHERHEIT NORD', 90, 120);
    context.fillStyle = '#12223d';
    context.font = '700 54px system-ui, sans-serif';
    context.fillText('Steueridentifikationsnummer', 90, 410);
    context.fillStyle = '#ffffff';
    context.strokeStyle = '#6f858d';
    context.lineWidth = 5;
    context.fillRect(80, 570, 1_240, 300);
    context.strokeRect(80, 570, 1_240, 300);
    context.fillStyle = '#12223d';
    context.font = '700 74px ui-monospace, SFMono-Regular, Consolas, monospace';
    context.textAlign = 'center';
    context.fillText(taxIdDisplayValue(value), 700, 750);
    context.textAlign = 'left';
    context.font = '500 38px system-ui, sans-serif';
    context.fillText('Vom Bewerber eingegeben und bestätigt.', 90, 1_080);
    context.fillText(
      'Die amtliche Zuordnung erfolgt im ELStAM-Verfahren.',
      90,
      1_150,
    );
    const encoded = await canvasToJpeg(canvas);
    return {
      quality: { accepted: true, status: 'accepted' },
      blob: encoded.blob,
      bytes: encoded.bytes,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function imageSourceFromFile(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Safari versions without this option use the image element fallback.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function normalizeTaxIdPhoto(file) {
  if (!(file instanceof File) || !file.type.startsWith('image/')) {
    throw new Error('Bitte ein Foto auswählen.');
  }
  const decoded = await imageSourceFromFile(file);
  const canvas = document.createElement('canvas');
  canvas.width = TAX_ID_PAGE_WIDTH;
  canvas.height = TAX_ID_PAGE_HEIGHT;
  try {
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#d8e0e2';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const padding = 36;
    const scale = Math.min(
      (canvas.width - padding * 2) / decoded.width,
      (canvas.height - padding * 2) / decoded.height,
    );
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      decoded.source,
      Math.round((canvas.width - width) / 2),
      Math.round((canvas.height - height) / 2),
      width,
      height,
    );
    const encoded = await canvasToJpeg(canvas);
    return {
      quality: { accepted: true, status: 'accepted' },
      blob: encoded.blob,
      bytes: encoded.bytes,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    decoded.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function produceCapture() {
  // Freeze the exact live frame at the 3–2–1 boundary. Using that same camera
  // geometry keeps the review crop identical to the guide the applicant saw.
  const still = captureVideoFrame();
  if (!still) throw new Error('Das Kamerabild ist noch nicht bereit.');
  const canvas = elements.captureCanvas;
  let image = null;
  let temporaryCanvas = null;
  try {
    const stageRect = elements.cameraStage.getBoundingClientRect();
    const guideClient = elements.idGuide.getBoundingClientRect();
    const sourceBox = guideCropInSource(
      {
        x: guideClient.left - stageRect.left,
        y: guideClient.top - stageRect.top,
        width: guideClient.width,
        height: guideClient.height,
      },
      still.width,
      still.height,
      stageRect.width,
      stageRect.height,
    );
    const crop = normalizedIdCrop(
      sourceBox,
      still.width,
      still.height,
      0,
      'portrait',
      activeProfile().aspectRatio,
    );
    const nativeLayout = portraitCaptureLayout(
      crop,
      MAX_CAPTURE_LONG_EDGE,
      activeProfile().aspectRatio,
    );
    const nativeWidth = nativeLayout.width;
    const nativeHeight = nativeLayout.height;
    canvas.width = nativeWidth;
    canvas.height = nativeHeight;
    let context = canvas.getContext('2d', {
      alpha: false,
      willReadFrequently: true,
    });
    drawPortraitCropAsLandscape(
      context,
      still.source,
      crop,
      nativeWidth,
      nativeHeight,
    );
    image = context.getImageData(0, 0, nativeWidth, nativeHeight);
    const nativeQuality = analyzeCaptureQuality(
      image,
      still.kind === 'video'
        ? {
            minimumLongEdge: VIDEO_FALLBACK_MIN_LONG_EDGE,
            minimumShortEdge: VIDEO_FALLBACK_MIN_SHORT_EDGE,
            minimumSharpness: VIDEO_FALLBACK_MIN_SHARPNESS,
          }
        : undefined,
    );
    if (!nativeQuality.accepted) return { quality: nativeQuality };
    image.data.fill(0);
    image = null;

    const outputWidth =
      still.kind === 'video' && nativeWidth < VIDEO_FALLBACK_OUTPUT_LONG_EDGE
        ? VIDEO_FALLBACK_OUTPUT_LONG_EDGE
        : nativeWidth;
    const outputHeight = Math.max(
      1,
      Math.floor(outputWidth / activeProfile().aspectRatio),
    );
    if (outputWidth !== nativeWidth) {
      temporaryCanvas = document.createElement('canvas');
      temporaryCanvas.width = nativeWidth;
      temporaryCanvas.height = nativeHeight;
      temporaryCanvas
        .getContext('2d', { alpha: false })
        .drawImage(canvas, 0, 0);
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      context = canvas.getContext('2d', {
        alpha: false,
        willReadFrequently: true,
      });
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(
        temporaryCanvas,
        0,
        0,
        nativeWidth,
        nativeHeight,
        0,
        0,
        outputWidth,
        outputHeight,
      );
    }
    image = context.getImageData(0, 0, outputWidth, outputHeight);
    enhanceScanPixels(image);
    context.putImageData(image, 0, 0);
    image.data.fill(0);
    image = null;
    const finalImage = context.getImageData(0, 0, outputWidth, outputHeight);
    const quality = analyzeCaptureQuality(finalImage);
    finalImage.data.fill(0);
    if (!quality.accepted) return { quality };
    const encoded = await canvasToJpeg(canvas);
    return {
      quality,
      blob: encoded.blob,
      bytes: encoded.bytes,
      width: outputWidth,
      height: outputHeight,
    };
  } finally {
    if (image) image.data.fill(0);
    if (temporaryCanvas) {
      temporaryCanvas.width = 0;
      temporaryCanvas.height = 0;
    }
    still.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

const STATUS_COPY = Object.freeze({
  open: 'Auswählbar',
  selected: 'Offen',
  'not-selected': 'Auswählbar',
  'not-scanned': 'Offen',
  'in-progress': 'Offen',
  complete: 'Abgeschlossen',
});

function renderDashboard() {
  const documents = availableDocuments();
  elements.taxIdCard.hidden = documentSetVersion < 3;
  const hasCompletedDocument = documents.some(
    (documentDefinition) =>
      documentScanStatus(documentDefinition, completedSlots) === 'complete',
  );
  for (const documentDefinition of documents) {
    const selected = selectedDocumentIds.has(documentDefinition.id);
    const scanStatus = documentScanStatus(documentDefinition, completedSlots);
    const status =
      sessionClosed && scanStatus === 'open'
        ? 'not-scanned'
        : selectionLocked
          ? selected
            ? scanStatus
            : 'not-selected'
          : scanStatus;
    const card = elements.documentList.querySelector(
      `[data-document="${documentDefinition.id}"]`,
    );
    const statusElement = card?.querySelector('[data-status]');
    if (card && statusElement) {
      statusElement.textContent = STATUS_COPY[status];
      statusElement.className = `document-status is-${status}`;
      card.disabled =
        busy ||
        pendingConfirm ||
        sessionClosed ||
        scanStatus === 'complete' ||
        (selectionLocked && !selected);
      card.classList.toggle('is-selected', selected);
      card.classList.toggle('is-not-selected', selectionLocked && !selected);
      card.removeAttribute('aria-pressed');
      card.setAttribute(
        'aria-label',
        `${documentDefinition.title}: ${STATUS_COPY[status]}`,
      );
    }
  }
  elements.documentFinish.hidden = !hasCompletedDocument;
  elements.finishSession.disabled =
    busy ||
    sessionClosed ||
    !sessionClaimed ||
    !canCompleteDocumentSession(completedSlots);
}

function showDashboard() {
  stopCamera();
  clearTaxIdEntry();
  elements.loading.hidden = true;
  elements.cameraStage.hidden = true;
  elements.review.hidden = true;
  elements.taxIdStage.hidden = true;
  elements.dashboard.hidden = false;
  elements.backToDashboard.hidden = true;
  if (!sessionClosed) elements.dashboardStatus.textContent = '';
  state = 'dashboard';
  elements.app.setAttribute('aria-busy', 'false');
  renderDashboard();
  elements.dashboardTitle.focus({ preventScroll: true });
}

function showTaxIdStage() {
  stopCamera();
  clearTaxIdEntry();
  elements.dashboard.hidden = true;
  elements.cameraStage.hidden = true;
  elements.review.hidden = true;
  elements.taxIdStage.hidden = false;
  elements.taxIdMethods.hidden = false;
  elements.taxIdForm.hidden = true;
  state = 'tax-id-method';
  elements.app.setAttribute('aria-busy', 'false');
  elements.taxIdTitle.focus({ preventScroll: true });
}

function backFromTaxIdStage() {
  if (busy || pendingConfirm || sessionClosed) return;
  selectedDocumentIds.clear();
  selectionLocked = false;
  showDashboard();
}

function showTaxIdInput() {
  if (busy || pendingConfirm || sessionClosed) return;
  elements.taxIdMethods.hidden = true;
  elements.taxIdForm.hidden = false;
  elements.taxIdInput.focus({ preventScroll: true });
}

async function submitTypedTaxId(event) {
  event.preventDefault();
  if (busy || pendingConfirm || sessionClosed) return;
  const normalized = normalizeTaxId(elements.taxIdInput.value);
  if (!normalized || !isPlausibleTaxId(normalized)) {
    elements.taxIdInput.setAttribute('aria-invalid', 'true');
    elements.taxIdError.textContent =
      'Diese Steueridentifikationsnummer ist nicht gültig. Bitte prüfen Sie die 11 Ziffern.';
    elements.taxIdInput.focus({ preventScroll: true });
    return;
  }
  busy = true;
  elements.taxIdSubmit.disabled = true;
  elements.taxIdError.textContent = '';
  elements.app.setAttribute('aria-busy', 'true');
  try {
    side = 'tax-id';
    applyProfileVisuals();
    const result = await renderTypedTaxId(normalized);
    clearTaxIdEntry();
    showCaptureReview(
      result,
      'Steueridentifikationsnummer auf Richtigkeit geprüft.',
    );
  } catch (error) {
    elements.taxIdError.textContent =
      error instanceof Error
        ? error.message
        : 'Die Steueridentifikationsnummer konnte nicht vorbereitet werden.';
  } finally {
    busy = false;
    elements.taxIdSubmit.disabled = false;
    elements.app.setAttribute('aria-busy', 'false');
    updateReviewControls();
  }
}

async function useTaxIdPhoto() {
  if (busy || pendingConfirm || sessionClosed) return;
  const file = elements.taxIdPhotoInput.files?.[0];
  if (!file) return;
  busy = true;
  elements.taxIdPhoto.disabled = true;
  elements.taxIdError.textContent = '';
  elements.app.setAttribute('aria-busy', 'true');
  try {
    side = 'tax-id';
    applyProfileVisuals();
    const result = await normalizeTaxIdPhoto(file);
    clearTaxIdEntry();
    showCaptureReview(
      result,
      'Steueridentifikationsnummer und Name lesbar – Dokumentausschnitt bestätigen.',
    );
  } catch (error) {
    elements.taxIdError.textContent =
      error instanceof Error
        ? error.message
        : 'Das Foto konnte nicht verarbeitet werden.';
  } finally {
    elements.taxIdPhotoInput.value = '';
    busy = false;
    elements.taxIdPhoto.disabled = false;
    elements.app.setAttribute('aria-busy', 'false');
    updateReviewControls();
  }
}

function openDocument(documentId) {
  if (
    busy ||
    pendingConfirm ||
    sessionClosed ||
    protocolVersion !== '2' ||
    captureMode !== 'documents-v2' ||
    !selectionLocked ||
    !selectedDocumentIds.has(documentId)
  ) {
    return;
  }
  const documentDefinition = availableDocuments().find(
    (candidate) => candidate.id === documentId,
  );
  if (!documentDefinition) return;
  const nextSlot = nextDocumentSlot(documentDefinition, completedSlots);
  if (!nextSlot) return;
  if (nextSlot === 'tax-id') {
    side = nextSlot;
    applyProfileVisuals();
    showTaxIdStage();
    return;
  }
  side = nextSlot;
  applyProfileVisuals();
  elements.dashboard.hidden = true;
  elements.review.hidden = true;
  elements.cameraStage.hidden = false;
  elements.backToDashboard.hidden = false;
  state = 'scanning';
  setGuide(false);
  setCameraMessage('Kamera wird geöffnet …', 'Bitte einen Moment warten.');
  elements.cameraStage.focus({ preventScroll: true });
  void requestCamera();
}

function startDocument(documentId) {
  if (
    busy ||
    pendingConfirm ||
    sessionClosed ||
    protocolVersion !== '2' ||
    captureMode !== 'documents-v2' ||
    selectionLocked
  ) {
    return;
  }
  const documentDefinition = availableDocuments().find(
    (candidate) => candidate.id === documentId,
  );
  if (
    !documentDefinition ||
    !nextDocumentSlot(documentDefinition, completedSlots)
  ) {
    return;
  }
  selectedDocumentIds.clear();
  selectedDocumentIds.add(documentId);
  selectionLocked = true;
  renderDashboard();
  openDocument(documentId);
}

function backToDashboard() {
  if (
    busy ||
    sessionClosed ||
    protocolVersion !== '2' ||
    state !== 'scanning'
  ) {
    return;
  }
  const activeDocument = availableDocuments().find((documentDefinition) =>
    selectedDocumentIds.has(documentDefinition.id),
  );
  if (
    activeDocument &&
    documentScanStatus(activeDocument, completedSlots) === 'open'
  ) {
    selectedDocumentIds.clear();
    selectionLocked = false;
  }
  showDashboard();
}

function resumeSelectedDocumentAfterClaim() {
  if (state !== 'scanning') {
    showDashboard();
    return;
  }
  const activeDocument = availableDocuments().find((documentDefinition) =>
    selectedDocumentIds.has(documentDefinition.id),
  );
  if (!activeDocument) {
    selectionLocked = false;
    showDashboard();
    return;
  }
  const nextSlot = nextDocumentSlot(activeDocument, completedSlots);
  if (!nextSlot) {
    selectedDocumentIds.clear();
    selectionLocked = false;
    showDashboard();
    return;
  }
  side = nextSlot;
  applyProfileVisuals();
  if (nextSlot === 'tax-id') showTaxIdStage();
  else resumeOrRequestCamera();
}

function resumeOrRequestCamera() {
  if (sessionClosed) return;
  if (mediaStream) {
    beginAnalysis();
    return;
  }
  state = 'scanning';
  setGuide(false);
  setCameraMessage('Kamera wird geöffnet …', 'Bitte einen Moment warten.');
  if (document.visibilityState === 'visible') void requestCamera();
}

async function captureAutomatically() {
  if (state !== 'scanning' || busy || sessionClosed) return;
  state = 'capturing';
  stopAnalysis();
  setGuide(true);
  // This happens synchronously at the end of the countdown, before any
  // autofocus, decoding, quality analysis, or relay work can add latency.
  triggerCaptureFeedback();
  elements.countdown.textContent = '';
  setCameraMessage(
    'Aufnahme wird erstellt …',
    '3–2–1 abgeschlossen. Bitte das Handy kurz ruhig halten.',
  );
  try {
    const result = await produceCapture();
    if (sessionClosed) return;
    if (!result.quality.accepted) {
      setGuide(false);
      setCameraMessage(
        'Aufnahme nicht angenommen.',
        `${result.quality.message} Neuer Versuch …`,
      );
      await wait(1_150);
      resumeOrRequestCamera();
      return;
    }
    // The accepted preview is a still image. Never leave the camera active
    // invisibly behind the review or upload screen.
    showCaptureReview(result, 'Angaben lesbar – Dokumentenkopie bestätigen.');
  } catch (error) {
    if (sessionClosed) return;
    setGuide(false);
    setCameraMessage(
      'Aufnahme konnte nicht geprüft werden.',
      error instanceof Error ? error.message : 'Bitte erneut versuchen.',
    );
    await wait(1_150);
    resumeOrRequestCamera();
  }
}

function updateReviewControls() {
  elements.useCapture.disabled =
    busy ||
    !sessionClaimed ||
    (!pendingConfirm &&
      !retryPayload &&
      (!acceptedCapture || !elements.consent.checked));
  elements.repeatCapture.disabled =
    busy || Boolean(retryPayload || pendingConfirm);
  elements.consent.disabled = busy || Boolean(retryPayload || pendingConfirm);
}

async function transferPreparedPayload(prepared) {
  setProgress(0);
  elements.reviewStatus.textContent = 'Sichere Übertragung …';
  await uploadChunksConcurrently(
    prepared.chunks,
    async (index, chunkBase64) => {
      await callRelayWithOneRetry(endpoint, 'upload', {
        sessionId,
        phoneSession,
        side: prepared.side,
        index,
        totalChunks: prepared.chunks.length,
        chunkBase64,
      });
    },
    {
      maxConcurrency: 2,
      onProgress: (completed, total) => {
        setProgress((completed / total) * 90);
      },
    },
  );
  elements.reviewStatus.textContent = 'Übertragung wird abgeschlossen …';
  setProgress(90);
  for (let attempt = 0; attempt < MAX_FINALIZE_ATTEMPTS; attempt += 1) {
    const response = await callRelayWithOneRetry(
      endpoint,
      'finalize',
      prepared.manifest,
    );
    if (response.status === 'finalized') {
      setProgress(100);
      return;
    }
    if (
      response.status !== 'missing' ||
      !Array.isArray(response.missingIndices) ||
      response.missingIndices.length < 1
    ) {
      throw new RelayError(
        'Der sichere Dienst hat einen unerwarteten Status geliefert.',
        false,
        'invalid-response',
      );
    }
    const missing = [...new Set(response.missingIndices)];
    if (
      missing.length !== response.missingIndices.length ||
      missing.some(
        (index) =>
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= prepared.chunks.length,
      )
    ) {
      throw new RelayError(
        'Der sichere Dienst hat einen unerwarteten Status geliefert.',
        false,
        'invalid-response',
      );
    }
    if (attempt === MAX_FINALIZE_ATTEMPTS - 1) {
      throw new RelayError(
        'Die Übertragung ist noch nicht vollständig. Bitte erneut versuchen.',
        true,
        'chunks-missing',
      );
    }
    await uploadChunksConcurrently(
      missing,
      async (_missingIndex, index) => {
        await callRelayWithOneRetry(endpoint, 'upload', {
          sessionId,
          phoneSession,
          side: prepared.side,
          index,
          totalChunks: prepared.chunks.length,
          chunkBase64: prepared.chunks[index],
        });
      },
      { maxConcurrency: 2 },
    );
  }
}

async function confirmCompletedSession() {
  const request = {
    sessionId,
    phoneSession,
  };
  if (protocolVersion === '2') {
    request.slots = [...completedSlots].sort((left, right) =>
      left.localeCompare(right),
    );
  }
  const response = await callRelayWithOneRetry(endpoint, 'confirm', {
    ...request,
  });
  if (response.status !== 'ready') {
    throw new RelayError(
      'Der sichere Dienst hat einen unerwarteten Status geliefert.',
      false,
      'invalid-response',
    );
  }
  pendingConfirm = false;
}

function advanceAfterFinalizedDocumentSlot(finalizedSide) {
  completedSlots.add(finalizedSide);
  const planStep = nextSelectedPlanStep(
    selectedDocumentIds,
    completedSlots,
    finalizedSide,
  );
  if (planStep.kind === 'capture') {
    clearAcceptedCapture();
    side = planStep.slot;
    applyProfileVisuals();
    elements.review.hidden = true;
    elements.cameraStage.hidden = false;
    state = 'scanning';
    elements.app.setAttribute('aria-busy', 'false');
    elements.cameraStage.focus({ preventScroll: true });
    resumeOrRequestCamera();
    return;
  }
  if (planStep.kind !== 'dashboard') {
    throw new Error('Der ausgewählte Scanplan ist ungültig.');
  }
  clearAcceptedCapture();
  selectedDocumentIds.clear();
  selectionLocked = false;
  showDashboard();
}

async function useCapture() {
  if (busy || sessionClosed) return;
  if (
    !pendingConfirm &&
    !retryPayload &&
    (!acceptedCapture || !elements.consent.checked)
  ) {
    return;
  }
  busy = true;
  updateReviewControls();
  elements.uploadProgress.hidden = pendingConfirm;
  if (pendingConfirm) {
    elements.reviewStatus.textContent = 'Abschluss wird bestätigt …';
    elements.useCapture.textContent = 'Wird bestätigt …';
  } else if (retryPayload) {
    elements.reviewStatus.textContent = 'Sichere Übertragung …';
    elements.useCapture.textContent = 'Wird übertragen …';
  } else {
    elements.reviewStatus.textContent =
      'Aufnahme wird auf diesem Handy verschlüsselt …';
    elements.useCapture.textContent = 'Wird verschlüsselt …';
  }
  try {
    if (pendingConfirm) {
      await confirmCompletedSession();
      completeSession();
      return;
    }
    if (!retryPayload) {
      retryPayload = await prepareEncryptedCapture({
        key: encryptionKey,
        sessionId,
        phoneSession,
        side,
        protocolVersion,
        jpegBytes: acceptedCapture.bytes,
        width: acceptedCapture.width,
        height: acceptedCapture.height,
      });
      acceptedCapture.bytes = null;
    }
    elements.useCapture.textContent = 'Wird übertragen …';
    await transferPreparedPayload(retryPayload);
    const finalizedSide = retryPayload.side;
    clearRetryPayload();
    if (protocolVersion === '2') {
      advanceAfterFinalizedDocumentSlot(finalizedSide);
      return;
    }
    if (finalizedSide === 'front') {
      clearAcceptedCapture();
      side = 'back';
      elements.sideLabel.textContent = sideTitle();
      elements.reviewTitle.textContent = sideTitle();
      elements.review.hidden = true;
      elements.cameraStage.hidden = false;
      state = 'scanning';
      elements.app.setAttribute('aria-busy', 'false');
      resumeOrRequestCamera();
      return;
    }
    pendingConfirm = true;
    elements.useCapture.textContent = 'Wird bestätigt …';
    elements.uploadProgress.hidden = true;
    elements.reviewStatus.textContent = 'Abschluss wird bestätigt …';
    await confirmCompletedSession();
    completeSession();
  } catch (error) {
    if (error instanceof RelayError && !error.retryable) {
      fail(error.message);
      return;
    }
    if (!retryPayload && !pendingConfirm) {
      clearAcceptedCapture();
      elements.review.hidden = true;
      elements.cameraStage.hidden = false;
      setCameraMessage(
        'Aufnahme muss wiederholt werden.',
        error instanceof Error ? error.message : 'Bitte erneut versuchen.',
      );
      resumeOrRequestCamera();
      return;
    }
    elements.reviewStatus.textContent =
      error instanceof Error
        ? error.message
        : 'Die sichere Übertragung wurde unterbrochen.';
    elements.useCapture.textContent = pendingConfirm
      ? 'Abschluss erneut bestätigen'
      : 'Übertragung erneut versuchen';
  } finally {
    busy = false;
    elements.uploadProgress.hidden = true;
    updateReviewControls();
    if (state === 'dashboard') renderDashboard();
  }
}

async function finishDocumentSession() {
  if (
    busy ||
    sessionClosed ||
    !sessionClaimed ||
    protocolVersion !== '2' ||
    captureMode !== 'documents-v2' ||
    !canCompleteDocumentSession(completedSlots)
  ) {
    return;
  }

  busy = true;
  pendingConfirm = true;
  elements.dashboardStatus.textContent = 'Übertragung wird abgeschlossen …';
  elements.finishSession.textContent = 'Wird abgeschlossen …';
  renderDashboard();

  try {
    await confirmCompletedSession();
    completeSession(true);
  } catch (error) {
    if (error instanceof RelayError && !error.retryable) {
      fail(error.message);
      return;
    }
    elements.dashboardStatus.textContent =
      error instanceof Error
        ? error.message
        : 'Die Übertragung konnte nicht abgeschlossen werden.';
  } finally {
    busy = false;
    if (!sessionClosed) {
      elements.finishSession.textContent = pendingConfirm
        ? 'Abschluss erneut versuchen'
        : 'Scan abschließen';
      renderDashboard();
    }
  }
}

function repeatCapture() {
  if (busy || retryPayload || pendingConfirm || sessionClosed) return;
  clearAcceptedCapture();
  elements.review.hidden = true;
  if (side === 'tax-id') {
    showTaxIdStage();
    return;
  }
  elements.cameraStage.hidden = false;
  elements.app.setAttribute('aria-busy', 'false');
  if (mediaStream) beginAnalysis();
  else resumeOrRequestCamera();
}

function completeSession(returnToDashboard = false) {
  stopCamera();
  clearTimeout(expiryTimer);
  expiryTimer = 0;
  clearRetryPayload();
  clearAcceptedCapture();
  encryptionKey = null;
  phoneSession = '';
  sessionId = '';
  endpoint = '';
  sessionClosed = true;
  elements.loading.hidden = true;
  elements.cameraStage.hidden = true;
  elements.review.hidden = true;
  elements.taxIdStage.hidden = true;
  elements.fatal.hidden = true;
  elements.app.setAttribute('aria-busy', 'false');
  if (returnToDashboard) {
    selectedDocumentIds.clear();
    selectionLocked = false;
    state = 'dashboard-complete';
    elements.complete.hidden = true;
    elements.dashboard.hidden = false;
    elements.dashboardStatus.textContent = 'Übertragung abgeschlossen.';
    elements.finishSession.textContent = 'Abgeschlossen';
    renderDashboard();
    elements.dashboardTitle.focus({ preventScroll: true });
    return;
  }
  state = 'complete';
  elements.dashboard.hidden = true;
  elements.complete.hidden = false;
  elements.complete.focus({ preventScroll: true });
}

async function resolveScannerBootstrap(initialBootstrap) {
  if (initialBootstrap.version !== '3') return initialBootstrap;

  const { endpoint: staticEndpoint, stationId } = initialBootstrap;
  const pairingKey = await importStaticPairingKey(
    initialBootstrap.pairingKeyBytes,
  );
  let discovered;
  let decrypted;
  try {
    discovered = await waitForStaticSession(staticEndpoint, stationId, {
      shouldContinue: () => !sessionClosed,
    });
    decrypted = await decryptStaticBootstrap({
      key: pairingKey,
      stationId,
      sessionId: discovered.sessionId,
      bootstrapIvBase64url: discovered.bootstrapIvBase64url,
      bootstrapCiphertextBase64url: discovered.bootstrapCiphertextBase64url,
    });
    return parseDiscoveredScannerBootstrap(decrypted, {
      sessionId: discovered.sessionId,
      endpoint: staticEndpoint,
    });
  } finally {
    if (discovered) {
      discovered.bootstrapIvBase64url = '';
      discovered.bootstrapCiphertextBase64url = '';
      discovered.sessionId = '';
    }
    if (decrypted && typeof decrypted === 'object') {
      for (const field of Object.keys(decrypted)) decrypted[field] = '';
    }
  }
}

async function start() {
  try {
    let bootstrapHash = window.location.hash;
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`,
    );
    if (!window.isSecureContext || !window.crypto?.subtle) {
      bootstrapHash = '';
      throw new Error(
        'Dieser Browser unterstützt die sichere Kameraerfassung nicht.',
      );
    }
    let parsedBootstrap;
    try {
      parsedBootstrap = parseScannerBootstrap(bootstrapHash);
    } finally {
      bootstrapHash = '';
    }
    if (parsedBootstrap.version === '2' || parsedBootstrap.version === '3') {
      // The document index is useful immediately and does not depend on relay
      // data. Keep the secure discovery/claim in the background so a permanent
      // QR never strands the applicant on a loading screen while the laptop is
      // still publishing its current session.
      protocolVersion = '2';
      captureMode = 'documents-v2';
      showDashboard();
    }
    const bootstrap = await resolveScannerBootstrap(parsedBootstrap);
    sessionId = bootstrap.sessionId;
    endpoint = bootstrap.endpoint;
    protocolVersion = bootstrap.version;
    captureMode = protocolVersion === '2' ? 'documents-v2' : 'identity-v1';
    documentSetVersion =
      protocolVersion === '2' && bootstrap.documentSetVersion === 3 ? 3 : 2;
    if (protocolVersion === '2') renderDashboard();
    side = 'front';
    phoneSession = createPhoneSession();
    let cameraAttempt = Promise.resolve(false);
    if (protocolVersion === '1') {
      elements.loading.hidden = true;
      elements.cameraStage.hidden = false;
      applyProfileVisuals();
      cameraAttempt = requestCamera();
    }
    encryptionKey = await importCaptureKey(bootstrap.keyBytes);
    let uploadCapability = bootstrap.uploadCapability;
    let claimed;
    try {
      claimed = await callRelayWithOneRetry(endpoint, 'claim', {
        sessionId,
        uploadCapability,
        phoneSession,
      });
    } finally {
      uploadCapability = '';
    }
    if (claimed.status !== 'claimed') {
      throw new RelayError(
        'Die sichere Sitzung konnte nicht gestartet werden.',
        false,
        'invalid-response',
      );
    }
    if (protocolVersion === '2') {
      const allowedSlots = new Set(
        availableDocuments().flatMap((documentDefinition) =>
          Array.from(documentDefinition.slots),
        ),
      );
      const claimedDocumentSetVersion = claimed.documentSetVersion ?? 2;
      if (
        claimed.captureMode !== 'documents-v2' ||
        claimedDocumentSetVersion !== documentSetVersion ||
        !Array.isArray(claimed.slotsReceived) ||
        claimed.slotsReceived.some(
          (slot) => typeof slot !== 'string' || !allowedSlots.has(slot),
        )
      ) {
        throw new RelayError(
          'Der sichere Dienst hat einen unerwarteten Status geliefert.',
          false,
          'invalid-response',
        );
      }
      completedSlots.clear();
      for (const slot of claimed.slotsReceived) completedSlots.add(slot);
    }
    scheduleExpiry(claimed.expiresAt);
    sessionClaimed = true;
    elements.app.setAttribute('aria-busy', 'false');
    if (protocolVersion === '2') {
      resumeSelectedDocumentAfterClaim();
      return;
    }
    await cameraAttempt;
    if (mediaStream) beginAnalysis();
    else if (!cameraRequest) elements.startCamera.hidden = false;
  } catch (error) {
    fail(
      error instanceof Error
        ? error.message
        : 'Die sichere Sitzung konnte nicht gestartet werden.',
    );
  }
}

elements.startCamera.addEventListener('click', () => void requestCamera());
elements.documentList.addEventListener('click', (event) => {
  const card = event.target.closest('[data-document]');
  if (!(card instanceof HTMLButtonElement)) return;
  if (selectionLocked) openDocument(card.dataset.document);
  else startDocument(card.dataset.document);
});
elements.taxIdBack.addEventListener('click', backFromTaxIdStage);
elements.taxIdType.addEventListener('click', showTaxIdInput);
elements.taxIdPhoto.addEventListener('click', () => {
  if (!busy && !pendingConfirm && !sessionClosed) {
    elements.taxIdPhotoInput.click();
  }
});
elements.taxIdPhotoInput.addEventListener('change', () => void useTaxIdPhoto());
elements.taxIdForm.addEventListener(
  'submit',
  (event) => void submitTypedTaxId(event),
);
elements.taxIdInput.addEventListener('input', () => {
  elements.taxIdInput.removeAttribute('aria-invalid');
  elements.taxIdError.textContent = '';
});
elements.backToDashboard.addEventListener('click', backToDashboard);
elements.finishSession.addEventListener(
  'click',
  () => void finishDocumentSession(),
);
elements.torchToggle.addEventListener(
  'click',
  () => void setTorch(!torchEnabled),
);
elements.consent.addEventListener('change', updateReviewControls);
elements.useCapture.addEventListener('click', () => void useCapture());
elements.repeatCapture.addEventListener('click', repeatCapture);
window.addEventListener('pagehide', disposeSensitiveState, { once: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (mediaStream || cameraRequest) stopCamera();
    return;
  }
  if (
    !sessionClosed &&
    sessionClaimed &&
    state === 'scanning' &&
    !mediaStream
  ) {
    state = 'scanning';
    setGuide(false);
    setCameraMessage('Kamera wird geöffnet …', 'Bitte einen Moment warten.');
    void requestCamera();
  }
});

if (!window.__SN_SCANNER_REDIRECTING__) void start();
