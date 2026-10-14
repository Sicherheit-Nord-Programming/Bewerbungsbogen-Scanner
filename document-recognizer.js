import {
  classifyDocumentText,
  parseOcrTsvLines,
} from './document-recognizer-core.js?v=20261014-document-allowlist-v26';

const OCR_INITIALIZATION_TIMEOUT_MS = 35_000;
const OCR_RECOGNITION_TIMEOUT_MS = 20_000;
const OCR_MAX_LONG_EDGE = 1_800;
const OCR_CACHE_PATH = 'sn-document-recognition-v1';

const WORKER_PATH = new URL('./ocr-v1/runtime/worker.min.js', import.meta.url)
  .href;
const CORE_PATH = new URL('./ocr-v1/core/', import.meta.url).href;
const LANGUAGE_PATH = new URL('./ocr-v1/lang', import.meta.url).href;

let worker = null;
let workerPromise = null;
let workerEpoch = 0;
let recognitionGeneration = 0;
let tesseractRuntime = null;
let runtimePromise = null;
let serialJob = Promise.resolve();
let activeProgressListener = null;
let activeOperationCancel = null;

function timeoutError(message) {
  const error = new Error(message);
  error.name = 'DocumentRecognitionTimeoutError';
  return error;
}

function cancellationError() {
  const error = new Error('Die lokale Dokumentprüfung wurde unterbrochen.');
  error.name = 'DocumentRecognitionCancelledError';
  return error;
}

function withTimeout(promise, timeoutMs, message, onTimeout = null) {
  let timer = 0;
  let cancelOperation = null;
  const timeout = new Promise((_, reject) => {
    timer = globalThis.setTimeout(() => {
      try {
        onTimeout?.();
      } finally {
        reject(timeoutError(message));
      }
    }, timeoutMs);
  });
  const cancelled = new Promise((_, reject) => {
    cancelOperation = (reason) => reject(reason);
  });
  activeOperationCancel = cancelOperation;
  return Promise.race([promise, timeout, cancelled]).finally(() => {
    globalThis.clearTimeout(timer);
    if (activeOperationCancel === cancelOperation) activeOperationCancel = null;
  });
}

async function invalidateWorker(reason = cancellationError()) {
  workerEpoch += 1;
  activeOperationCancel?.(reason);
  const current = worker;
  worker = null;
  workerPromise = null;
  if (current) await current.terminate().catch(() => {});
}

function ocrProgress(message) {
  if (typeof activeProgressListener !== 'function') return;
  const progress = Number(message?.progress);
  activeProgressListener({
    status: String(message?.status || ''),
    progress: Number.isFinite(progress)
      ? Math.max(0, Math.min(1, progress))
      : null,
  });
}

function getWorker() {
  if (worker) return Promise.resolve(worker);
  if (workerPromise) return workerPromise;

  const epoch = workerEpoch;
  if (!runtimePromise) {
    runtimePromise = import('./ocr-v1/runtime/tesseract.esm.min.js').then(
      ({ default: runtime }) => {
        tesseractRuntime = runtime;
        return runtime;
      },
    );
  }
  const created = runtimePromise.then((runtime) =>
    runtime.createWorker('deu', runtime.OEM.LSTM_ONLY, {
      workerPath: WORKER_PATH,
      corePath: CORE_PATH,
      langPath: LANGUAGE_PATH,
      cachePath: OCR_CACHE_PATH,
      cacheMethod: 'write',
      gzip: true,
      workerBlobURL: false,
      logger: ocrProgress,
      errorHandler: () => {},
    }),
  );
  void created.then(
    (createdWorker) => {
      if (epoch !== workerEpoch) void createdWorker.terminate().catch(() => {});
    },
    () => {},
  );

  workerPromise = withTimeout(
    created,
    OCR_INITIALIZATION_TIMEOUT_MS,
    'Die lokale Dokumenterkennung konnte nicht geladen werden.',
    () => void invalidateWorker(),
  )
    .then(async (createdWorker) => {
      if (epoch !== workerEpoch) {
        await createdWorker.terminate().catch(() => {});
        throw new Error('Die lokale Dokumenterkennung wurde neu gestartet.');
      }
      worker = createdWorker;
      return worker;
    })
    .catch((error) => {
      if (epoch === workerEpoch) {
        worker = null;
        workerPromise = null;
      }
      if (!tesseractRuntime) runtimePromise = null;
      throw error;
    });
  return workerPromise;
}

function scheduleJob(job) {
  const result = serialJob.then(job, job);
  serialJob = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function imageRegion(source, region = null) {
  const sourceWidth = Math.max(1, Number(source?.width) || 0);
  const sourceHeight = Math.max(1, Number(source?.height) || 0);
  if (!region) {
    return { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  }
  const x = Math.max(0, Math.min(sourceWidth - 1, Math.floor(region.x)));
  const y = Math.max(0, Math.min(sourceHeight - 1, Math.floor(region.y)));
  const width = Math.max(
    1,
    Math.min(sourceWidth - x, Math.floor(region.width)),
  );
  const height = Math.max(
    1,
    Math.min(sourceHeight - y, Math.floor(region.height)),
  );
  return { x, y, width, height };
}

function prepareOcrCanvas(source, region = null) {
  const crop = imageRegion(source, region);
  const scale = Math.min(
    1,
    OCR_MAX_LONG_EDGE / Math.max(crop.width, crop.height),
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));
  const context = canvas.getContext('2d', {
    alpha: false,
    willReadFrequently: true,
  });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
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

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const histogram = new Uint32Array(256);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const gray = Math.round(
      image.data[offset] * 0.299 +
        image.data[offset + 1] * 0.587 +
        image.data[offset + 2] * 0.114,
    );
    histogram[gray] += 1;
  }
  const pixels = canvas.width * canvas.height;
  const percentile = (fraction) => {
    const target = pixels * fraction;
    let count = 0;
    for (let value = 0; value < histogram.length; value += 1) {
      count += histogram[value];
      if (count >= target) return value;
    }
    return 255;
  };
  const low = percentile(0.03);
  const high = percentile(0.97);
  const range = Math.max(42, high - low);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const gray =
      image.data[offset] * 0.299 +
      image.data[offset + 1] * 0.587 +
      image.data[offset + 2] * 0.114;
    const normalized = Math.max(
      0,
      Math.min(255, Math.round(((gray - low) * 255) / range)),
    );
    image.data[offset] = normalized;
    image.data[offset + 1] = normalized;
    image.data[offset + 2] = normalized;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  image.data.fill(0);
  histogram.fill(0);
  return canvas;
}

function mrzRegionForSlot(canvas, slot) {
  const normalizedSlot = slot === 'back' ? 'id-back' : slot;
  const topFraction = normalizedSlot === 'passport-data' ? 0.58 : 0.5;
  return {
    x: 0,
    y: Math.floor(canvas.height * topFraction),
    width: canvas.width,
    height: Math.max(
      1,
      canvas.height - Math.floor(canvas.height * topFraction),
    ),
  };
}

async function recognizeText(ocrWorker, canvas, parameters) {
  await ocrWorker.setParameters(parameters);
  const recognition = ocrWorker.recognize(
    canvas,
    { rotateAuto: false },
    { text: true, tsv: true },
  );
  return withTimeout(
    recognition,
    OCR_RECOGNITION_TIMEOUT_MS,
    'Die lokale Dokumentprüfung hat zu lange gedauert.',
    () => void invalidateWorker(),
  );
}

function failure(reason, code = 'recognition-unavailable') {
  return {
    accepted: false,
    detectedSlot: null,
    evidence: [],
    reason,
    code,
  };
}

function assertCurrentRecognition(generation) {
  if (generation !== recognitionGeneration) throw cancellationError();
}

export async function warmDocumentRecognizer() {
  const generation = recognitionGeneration;
  try {
    return await scheduleJob(async () => {
      assertCurrentRecognition(generation);
      await getWorker();
      assertCurrentRecognition(generation);
      return true;
    });
  } catch {
    return false;
  }
}

export async function recognizeDocumentCanvas(
  source,
  expectedSlot,
  { onProgress = null } = {},
) {
  const generation = recognitionGeneration;
  return scheduleJob(async () => {
    activeProgressListener = onProgress;
    let fullCanvas = null;
    let mrzCanvas = null;
    try {
      assertCurrentRecognition(generation);
      const ocrWorker = await getWorker();
      assertCurrentRecognition(generation);
      fullCanvas = prepareOcrCanvas(source);
      const normalizedSlot =
        expectedSlot === 'front'
          ? 'id-front'
          : expectedSlot === 'back'
            ? 'id-back'
            : expectedSlot;

      let text = '';
      let mrzText = '';
      let confidence = 0;
      let layout = [];
      if (normalizedSlot === 'id-back' || normalizedSlot === 'passport-data') {
        mrzCanvas = prepareOcrCanvas(
          fullCanvas,
          mrzRegionForSlot(fullCanvas, normalizedSlot),
        );
        const mrzResult = await recognizeText(ocrWorker, mrzCanvas, {
          tessedit_pageseg_mode: tesseractRuntime.PSM.SINGLE_BLOCK,
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        });
        assertCurrentRecognition(generation);
        mrzText = String(mrzResult?.data?.text || '');
        confidence = Number(mrzResult?.data?.confidence) || 0;
      } else {
        const fullResult = await recognizeText(ocrWorker, fullCanvas, {
          tessedit_pageseg_mode: tesseractRuntime.PSM.SPARSE_TEXT,
          tessedit_char_whitelist: '',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        });
        assertCurrentRecognition(generation);
        text = String(fullResult?.data?.text || '');
        confidence = Number(fullResult?.data?.confidence) || 0;
        layout = parseOcrTsvLines(
          fullResult?.data?.tsv,
          fullCanvas.width,
          fullCanvas.height,
        );
      }

      return classifyDocumentText(
        { text, mrzText, confidence, layout },
        normalizedSlot,
      );
    } catch (error) {
      if (error?.name === 'DocumentRecognitionCancelledError') {
        return failure(
          'Die Dokumentprüfung wurde neu gestartet.',
          'recognition-cancelled',
        );
      }
      return failure(
        error?.name === 'DocumentRecognitionTimeoutError'
          ? 'Die Dokumentprüfung hat zu lange gedauert. Bitte ruhig halten und erneut versuchen.'
          : 'Der Dokumenttyp konnte lokal nicht eindeutig erkannt werden. Bitte erneut ausrichten.',
        error?.name === 'DocumentRecognitionTimeoutError'
          ? 'recognition-timeout'
          : 'recognition-unavailable',
      );
    } finally {
      activeProgressListener = null;
      if (mrzCanvas) {
        mrzCanvas.width = 0;
        mrzCanvas.height = 0;
      }
      if (fullCanvas) {
        fullCanvas.width = 0;
        fullCanvas.height = 0;
      }
    }
  });
}

export async function cancelDocumentRecognition() {
  recognitionGeneration += 1;
  const queuedBeforeCancellation = serialJob;
  await Promise.allSettled([
    invalidateWorker(cancellationError()),
    queuedBeforeCancellation,
  ]);
}

export async function disposeDocumentRecognizer() {
  await cancelDocumentRecognition();
}
