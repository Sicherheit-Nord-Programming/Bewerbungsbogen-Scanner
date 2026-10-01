import {
  analyzeCaptureQuality,
  analyzeFramePosition,
  coverSourceRect,
  createHoldState,
  enhanceScanPixels,
  normalizedIdCrop,
  parseScannerBootstrap,
  updateHoldState,
} from './scanner-core.js';
import {
  callRelayWithOneRetry,
  createPhoneSession,
  disposePreparedCapture,
  importCaptureKey,
  prepareEncryptedCapture,
  RelayError,
} from './relay-client.js';

const MAX_FINALIZE_ATTEMPTS = 5;
const LIVE_ANALYSIS_INTERVAL_MS = 145;
const MAX_LIVE_ANALYSIS_EDGE = 480;
const MAX_CAPTURE_LONG_EDGE = 2_400;
const VIDEO_FALLBACK_MIN_LONG_EDGE = 900;
const VIDEO_FALLBACK_MIN_SHORT_EDGE = 560;
const VIDEO_FALLBACK_MIN_SHARPNESS = 12;
const VIDEO_FALLBACK_OUTPUT_LONG_EDGE = 1_600;
// A native ImageCapture can wait for autofocus/exposure indefinitely on some
// mobile browsers.  The live video frame is already available and is a safe,
// immediate fallback once this short window has elapsed.
const STILL_CAPTURE_TIMEOUT_MS = 900;
const CAPTURE_VIBRATION_PATTERN = [80, 40, 120];

const elements = Object.fromEntries(
  [
    'app',
    'camera-stage',
    'camera',
    'id-guide',
    'countdown',
    'side-label',
    'instruction',
    'camera-status',
    'start-camera',
    'review',
    'preview',
    'quality-message',
    'consent',
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
let side = 'front';
let state = 'starting';
let mediaStream = null;
let cameraPromise = null;
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

function setCameraMessage(instruction, status = '') {
  elements.instruction.textContent = instruction;
  elements.cameraStatus.textContent = status;
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

function withTimeout(promise, milliseconds, message) {
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timer);
  });
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

function stopAnalysis() {
  analysisGeneration += 1;
  cancelAnimationFrame(analysisFrame);
  analysisFrame = 0;
  elements.countdown.textContent = '';
}

function stopCamera() {
  stopAnalysis();
  cameraGeneration += 1;
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) track.stop();
  }
  mediaStream = null;
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
  elements.qualityMessage.textContent = '';
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
  elements.analysisCanvas.width = 0;
  elements.analysisCanvas.height = 0;
  elements.captureCanvas.width = 0;
  elements.captureCanvas.height = 0;
}

function fail(message) {
  if (!sessionClosed) disposeSensitiveState();
  state = 'fatal';
  elements.cameraStage.hidden = true;
  elements.review.hidden = true;
  elements.complete.hidden = true;
  elements.fatal.hidden = false;
  elements.fatalMessage.textContent = message;
  elements.app.setAttribute('aria-busy', 'false');
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
  if (cameraPromise) return cameraPromise;
  const generation = ++cameraGeneration;
  elements.startCamera.hidden = true;
  setCameraMessage(
    'Kamera wird geöffnet …',
    'Beim ersten Mal bitte den Kamerazugriff bestätigen.',
  );
  cameraPromise = (async () => {
    let stream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException('getUserMedia fehlt', 'NotSupportedError');
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: innerHeight >= innerWidth ? 2_160 : 3_840 },
          height: { ideal: innerHeight >= innerWidth ? 3_840 : 2_160 },
        },
      });
      if (generation !== cameraGeneration || sessionClosed) {
        for (const track of stream.getTracks()) track.stop();
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
      mediaStream = stream;
      elements.camera.srcObject = stream;
      await waitForVideoMetadata(elements.camera);
      await elements.camera.play();
      if (generation !== cameraGeneration || sessionClosed) {
        stopCamera();
        return false;
      }
      setCameraMessage(
        'Ausweis vollständig in den Rahmen halten.',
        sessionClaimed
          ? 'Der rote Rahmen wird automatisch grün, sobald die Position passt.'
          : 'Sichere Sitzung wird vorbereitet …',
      );
      if (sessionClaimed) beginAnalysis();
      return true;
    } catch (error) {
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
      }
      if (mediaStream === stream) {
        mediaStream = null;
        elements.camera.pause();
        elements.camera.srcObject = null;
      }
      if (generation === cameraGeneration && !sessionClosed) {
        setGuide(false);
        setCameraMessage('Kamera wird benötigt.', cameraFailureMessage(error));
        elements.startCamera.hidden = false;
      }
      return false;
    } finally {
      cameraPromise = null;
    }
  })();
  return cameraPromise;
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
  setCameraMessage(
    'Ausweis vollständig in den Rahmen halten.',
    'Der rote Rahmen wird automatisch grün, sobald die Position passt.',
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
          elements.instruction.textContent = 'Position passt – ruhig halten.';
          elements.cameraStatus.textContent = `Automatische Aufnahme in ${Math.max(
            1,
            holdState.countdown,
          )} …`;
          elements.countdown.textContent = holdState.countdown || '';
        } else {
          elements.instruction.textContent = observation.reason;
          elements.cameraStatus.textContent =
            'Der Rahmen wird grün, sobald der Ausweis richtig liegt.';
          elements.countdown.textContent = '';
        }
        // `updateHoldState` keeps a short grace window for one noisy camera
        // frame.  Once the three seconds are complete, use the last stable
        // box even if this exact frame briefly failed edge detection; waiting
        // for another positioned frame was the source of late/missed shots.
        if (holdState.ready && lastPositionedBox) {
          void captureAutomatically(lastPositionedBox);
          return;
        }
      } catch {
        setGuide(false);
        setCameraMessage(
          'Ausweis vollständig in den Rahmen halten.',
          'Das Kamerabild wird vorbereitet …',
        );
      }
    }
    analysisFrame = requestAnimationFrame(loop);
  };
  analysisFrame = requestAnimationFrame(loop);
}

async function decodePhotoBlob(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: 'from-image',
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Safari camera formats can require the native image decoder below.
    }
  }
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Das Kamerabild ist unlesbar.'));
      image.src = objectUrl;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function bestStillSource() {
  const track = mediaStream?.getVideoTracks?.()[0];
  if (track && typeof window.ImageCapture === 'function') {
    try {
      const capture = new window.ImageCapture(track);
      // Do not wait indefinitely for autofocus/exposure or photo capabilities.
      // If the native still is not ready almost immediately, the current video
      // frame is used below so the 3–2–1 trigger always produces a capture.
      const photoBlob = await withTimeout(
        capture.takePhoto(),
        STILL_CAPTURE_TIMEOUT_MS,
        'Die Standbildaufnahme reagiert zu langsam.',
      );
      const decoded = await withTimeout(
        decodePhotoBlob(photoBlob),
        STILL_CAPTURE_TIMEOUT_MS,
        'Das Standbild konnte nicht schnell genug verarbeitet werden.',
      );
      return { ...decoded, kind: 'photo' };
    } catch {
      // iOS/Safari and some Android WebViews need the video-frame fallback.
    }
  }
  return {
    source: elements.camera,
    width: elements.camera.videoWidth,
    height: elements.camera.videoHeight,
    close: () => {},
    kind: 'video',
  };
}

function mapBoxToSource(box, analysisWidth, analysisHeight, sourceCrop) {
  return {
    x: sourceCrop.x + (box.x / analysisWidth) * sourceCrop.width,
    y: sourceCrop.y + (box.y / analysisHeight) * sourceCrop.height,
    width: (box.width / analysisWidth) * sourceCrop.width,
    height: (box.height / analysisHeight) * sourceCrop.height,
  };
}

async function canvasToJpeg(canvas) {
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.94),
  );
  if (!blob) throw new Error('Die Aufnahme konnte nicht verarbeitet werden.');
  return { blob, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

async function produceCapture(positionedBox) {
  const still = await bestStillSource();
  const canvas = elements.captureCanvas;
  let image = null;
  let temporaryCanvas = null;
  try {
    const stageRect = elements.cameraStage.getBoundingClientRect();
    const sourceCrop = coverSourceRect(
      still.width,
      still.height,
      stageRect.width,
      stageRect.height,
    );
    const sourceBox = mapBoxToSource(
      positionedBox,
      elements.analysisCanvas.width,
      elements.analysisCanvas.height,
      sourceCrop,
    );
    const crop = normalizedIdCrop(sourceBox, still.width, still.height);
    const nativeWidth = Math.max(
      1,
      Math.floor(Math.min(MAX_CAPTURE_LONG_EDGE, crop.width)),
    );
    const nativeHeight = Math.max(1, Math.floor(nativeWidth / (85.6 / 53.98)));
    canvas.width = nativeWidth;
    canvas.height = nativeHeight;
    let context = canvas.getContext('2d', {
      alpha: false,
      willReadFrequently: true,
    });
    context.drawImage(
      still.source,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
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
    const outputHeight = Math.max(1, Math.floor(outputWidth / (85.6 / 53.98)));
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

function resumeOrRequestCamera() {
  if (sessionClosed) return;
  if (mediaStream) {
    beginAnalysis();
    return;
  }
  state = 'scanning';
  setGuide(false);
  setCameraMessage('Kamera wird geöffnet …', 'Bitte einen Moment warten.');
  void requestCamera();
}

async function captureAutomatically(positionedBox) {
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
    const result = await produceCapture(positionedBox);
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
    acceptedCapture = result;
    // The accepted preview is a still image. Never leave the camera active
    // invisibly behind the review or upload screen.
    stopCamera();
    previewUrl = URL.createObjectURL(result.blob);
    elements.preview.src = previewUrl;
    elements.qualityMessage.textContent =
      'Technische Prüfung bestanden. Bitte kurz kontrollieren, ob alle Angaben vollständig lesbar sind.';
    elements.consent.checked = false;
    elements.useCapture.disabled = true;
    elements.useCapture.textContent = 'Aufnahme verwenden';
    elements.repeatCapture.disabled = false;
    elements.reviewStatus.textContent = '';
    elements.uploadProgress.hidden = true;
    elements.review.hidden = false;
    state = 'review';
    elements.app.setAttribute('aria-busy', 'false');
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
    (!pendingConfirm &&
      !retryPayload &&
      (!acceptedCapture || !elements.consent.checked));
  elements.repeatCapture.disabled =
    busy || Boolean(retryPayload || pendingConfirm);
  elements.consent.disabled = busy || Boolean(retryPayload || pendingConfirm);
}

async function transferPreparedPayload(prepared) {
  for (let index = 0; index < prepared.chunks.length; index += 1) {
    elements.reviewStatus.textContent = `Sichere Übertragung ${index + 1} von ${prepared.chunks.length} …`;
    setProgress((index / prepared.chunks.length) * 90);
    await callRelayWithOneRetry(endpoint, 'upload', {
      sessionId,
      phoneSession,
      side: prepared.side,
      index,
      totalChunks: prepared.chunks.length,
      chunkBase64: prepared.chunks[index],
    });
  }
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
    for (const index of missing) {
      await callRelayWithOneRetry(endpoint, 'upload', {
        sessionId,
        phoneSession,
        side: prepared.side,
        index,
        totalChunks: prepared.chunks.length,
        chunkBase64: prepared.chunks[index],
      });
    }
  }
}

async function confirmCompletedSession() {
  const response = await callRelayWithOneRetry(endpoint, 'confirm', {
    sessionId,
    phoneSession,
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
  elements.reviewStatus.textContent = pendingConfirm
    ? 'Abschluss wird sicher bestätigt …'
    : 'Aufnahme wird auf diesem Handy verschlüsselt …';
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
        jpegBytes: acceptedCapture.bytes,
        width: acceptedCapture.width,
        height: acceptedCapture.height,
      });
      acceptedCapture.bytes = null;
    }
    elements.useCapture.textContent = 'Übertragung erneut versuchen';
    await transferPreparedPayload(retryPayload);
    const finalizedSide = retryPayload.side;
    clearRetryPayload();
    if (finalizedSide === 'front') {
      clearAcceptedCapture();
      side = 'back';
      elements.sideLabel.textContent = 'Rückseite · 2 von 2';
      elements.review.hidden = true;
      elements.cameraStage.hidden = false;
      state = 'scanning';
      elements.app.setAttribute('aria-busy', 'false');
      resumeOrRequestCamera();
      return;
    }
    pendingConfirm = true;
    elements.useCapture.textContent = 'Abschluss erneut bestätigen';
    elements.uploadProgress.hidden = true;
    elements.reviewStatus.textContent = 'Abschluss wird sicher bestätigt …';
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
  }
}

function repeatCapture() {
  if (busy || retryPayload || pendingConfirm || sessionClosed) return;
  clearAcceptedCapture();
  elements.review.hidden = true;
  elements.cameraStage.hidden = false;
  elements.app.setAttribute('aria-busy', 'false');
  if (mediaStream) beginAnalysis();
  else resumeOrRequestCamera();
}

function completeSession() {
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
  state = 'complete';
  elements.cameraStage.hidden = true;
  elements.review.hidden = true;
  elements.fatal.hidden = true;
  elements.complete.hidden = false;
  elements.app.setAttribute('aria-busy', 'false');
}

async function start() {
  try {
    if (!window.isSecureContext || !window.crypto?.subtle) {
      throw new Error(
        'Dieser Browser unterstützt die sichere Kameraerfassung nicht.',
      );
    }
    const bootstrap = parseScannerBootstrap(window.location.hash);
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`,
    );
    sessionId = bootstrap.sessionId;
    endpoint = bootstrap.endpoint;
    phoneSession = createPhoneSession();
    const cameraAttempt = requestCamera();
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
    scheduleExpiry(claimed.expiresAt);
    sessionClaimed = true;
    elements.app.setAttribute('aria-busy', 'false');
    await cameraAttempt;
    if (mediaStream) beginAnalysis();
    else if (!cameraPromise) elements.startCamera.hidden = false;
  } catch (error) {
    fail(
      error instanceof Error
        ? error.message
        : 'Die sichere Sitzung konnte nicht gestartet werden.',
    );
  }
}

elements.startCamera.addEventListener('click', () => void requestCamera());
elements.consent.addEventListener('change', updateReviewControls);
elements.useCapture.addEventListener('click', () => void useCapture());
elements.repeatCapture.addEventListener('click', repeatCapture);
window.addEventListener('pagehide', disposeSensitiveState, { once: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (mediaStream) stopCamera();
    return;
  }
  if (
    !sessionClosed &&
    sessionClaimed &&
    (state === 'scanning' || state === 'capturing') &&
    !mediaStream
  ) {
    state = 'scanning';
    setGuide(false);
    setCameraMessage('Kamera wird benötigt.', 'Bitte Kamera erneut öffnen.');
    elements.startCamera.hidden = false;
  }
});

void start();
