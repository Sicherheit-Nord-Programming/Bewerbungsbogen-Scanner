const CHUNK_CHARACTERS = 64 * 1024;
const MAX_CIPHERTEXT_BYTES = 8 * 1024 * 1024;
const CONSENT_VERSION = 'id-copy-consent-de-v1';
const STATIC_BOOTSTRAP_AAD_DOMAIN = 'SN-ID-STATIC-BOOTSTRAP/v1|';
const STATIC_DISCOVERY_INTERVAL_MS = 1_500;
const SESSION_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const STATION_PATTERN = /^[a-f0-9]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export class RelayError extends Error {
  constructor(message, retryable = false, code = 'service-unavailable') {
    super(message);
    this.name = 'RelayError';
    this.retryable = Boolean(retryable);
    this.code = code;
  }
}

export function bytesToBase64url(bytes) {
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64urlToBytes(value) {
  if (typeof value !== 'string' || !BASE64URL_PATTERN.test(value)) {
    throw new Error('invalid-base64url');
  }
  const base64 =
    value.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytesToBase64url(bytes) !== value) {
    bytes.fill(0);
    throw new Error('invalid-base64url');
  }
  return bytes;
}

export function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

export function createPhoneSession(cryptoApi = globalThis.crypto) {
  const bytes = cryptoApi.getRandomValues(new Uint8Array(32));
  try {
    return bytesToBase64url(bytes);
  } finally {
    bytes.fill(0);
  }
}

export async function importCaptureKey(
  keyBytes,
  cryptoApi = globalThis.crypto,
) {
  try {
    return await cryptoApi.subtle.importKey('raw', keyBytes, 'AES-GCM', false, [
      'encrypt',
    ]);
  } finally {
    keyBytes.fill(0);
  }
}

export async function importStaticPairingKey(
  keyBytes,
  cryptoApi = globalThis.crypto,
) {
  try {
    if (!(keyBytes instanceof Uint8Array) || keyBytes.length !== 32) {
      throw new TypeError('Der statische QR-Schlüssel ist ungültig.');
    }
    return await cryptoApi.subtle.importKey('raw', keyBytes, 'AES-GCM', false, [
      'decrypt',
    ]);
  } finally {
    keyBytes?.fill?.(0);
  }
}

export async function callRelay(
  endpoint,
  action,
  request,
  { fetchImpl = globalThis.fetch, timeoutMs = 30_000 } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        mode: 'cors',
        redirect: 'follow',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ schemaVersion: 1, action, request }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new RelayError(
        error?.name === 'AbortError'
          ? 'Der sichere Dienst antwortet nicht. Bitte erneut versuchen.'
          : 'Der sichere Dienst ist vorübergehend nicht erreichbar.',
        true,
        error?.name === 'AbortError' ? 'timeout' : 'network',
      );
    }
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new RelayError(
        'Der sichere Dienst hat keine gültige Antwort geliefert.',
        true,
        'invalid-response',
      );
    }
    if (!response.ok) {
      throw new RelayError(
        payload?.message || 'Der sichere Dienst ist nicht erreichbar.',
        response.status >= 500,
        payload?.code || `http-${response.status}`,
      );
    }
    if (
      payload?.schemaVersion !== 1 ||
      payload?.action !== action ||
      typeof payload?.status !== 'string'
    ) {
      throw new RelayError(
        'Der sichere Dienst hat einen unerwarteten Status geliefert.',
        false,
        'invalid-response',
      );
    }
    if (payload.status === 'failed') {
      throw new RelayError(
        payload.message ||
          (payload.retryable
            ? 'Die sichere Übertragung wurde unterbrochen. Bitte erneut versuchen.'
            : 'Die Scan-Verbindung ist nicht mehr gültig. Bitte scannen Sie den QR-Code am Laptop erneut.'),
        payload.retryable,
        payload.code,
      );
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function callRelayWithOneRetry(
  endpoint,
  action,
  request,
  options,
) {
  try {
    return await callRelay(endpoint, action, request, options);
  } catch (error) {
    if (!(error instanceof RelayError) || !error.retryable) throw error;
    return callRelay(endpoint, action, request, options);
  }
}

export async function uploadChunksConcurrently(
  chunks,
  uploadChunk,
  { maxConcurrency = 2, onProgress = () => {} } = {},
) {
  if (!Array.isArray(chunks) || chunks.length < 1) {
    throw new TypeError('Die verschlüsselte Aufnahme ist unvollständig.');
  }
  if (typeof uploadChunk !== 'function') {
    throw new TypeError('Die Upload-Funktion ist ungültig.');
  }
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new TypeError('Die Upload-Parallelität ist ungültig.');
  }
  if (typeof onProgress !== 'function') {
    throw new TypeError('Die Fortschrittsfunktion ist ungültig.');
  }

  let nextIndex = 0;
  let completed = 0;
  let firstError = null;
  const workerCount = Math.min(maxConcurrency, chunks.length);

  async function worker() {
    while (!firstError) {
      const index = nextIndex;
      if (index >= chunks.length) return;
      nextIndex += 1;
      try {
        await uploadChunk(index, chunks[index]);
        completed += 1;
        onProgress(completed, chunks.length);
      } catch (error) {
        firstError ??= error;
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (firstError) throw firstError;
}

function discoveryWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function callRelayWithRecovery(
  endpoint,
  action,
  request,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = 30_000,
    waitImpl = discoveryWait,
    shouldContinue = () => true,
    retryDelayMs = 900,
  } = {},
) {
  while (shouldContinue()) {
    try {
      const response = await callRelayWithOneRetry(endpoint, action, request, {
        fetchImpl,
        timeoutMs,
      });
      if (shouldContinue()) return response;
      break;
    } catch (error) {
      if (!(error instanceof RelayError) || !error.retryable) throw error;
      if (!shouldContinue()) break;
      await waitImpl(retryDelayMs);
    }
  }
  throw new RelayError(
    'Die sichere Verbindung wurde beendet.',
    false,
    'cancelled',
  );
}

export async function waitForStaticSession(
  endpoint,
  stationId,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = 30_000,
    intervalMs = STATIC_DISCOVERY_INTERVAL_MS,
    waitImpl = discoveryWait,
    shouldContinue = () => true,
  } = {},
) {
  if (!STATION_PATTERN.test(stationId)) {
    throw new TypeError('Die Scanner-Station ist ungültig.');
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new TypeError('Das Abfrageintervall ist ungültig.');
  }
  while (shouldContinue()) {
    const response = await callRelayWithRecovery(
      endpoint,
      'discover',
      { stationId },
      {
        fetchImpl,
        timeoutMs,
        waitImpl,
        shouldContinue,
        retryDelayMs: intervalMs,
      },
    );
    if (response.status === 'waiting') {
      await waitImpl(intervalMs);
      continue;
    }
    if (
      response.status !== 'available' ||
      !SESSION_PATTERN.test(response.sessionId) ||
      !Number.isSafeInteger(response.expiresAt) ||
      typeof response.bootstrapIvBase64url !== 'string' ||
      typeof response.bootstrapCiphertextBase64url !== 'string'
    ) {
      throw new RelayError(
        'Der sichere Dienst hat einen unerwarteten Status geliefert.',
        false,
        'invalid-response',
      );
    }
    return response;
  }
  throw new RelayError(
    'Die sichere Verbindung wurde beendet.',
    false,
    'cancelled',
  );
}

export async function decryptStaticBootstrap({
  key,
  stationId,
  sessionId,
  bootstrapIvBase64url,
  bootstrapCiphertextBase64url,
  cryptoApi = globalThis.crypto,
}) {
  if (
    !STATION_PATTERN.test(stationId) ||
    !SESSION_PATTERN.test(sessionId) ||
    typeof bootstrapIvBase64url !== 'string' ||
    bootstrapIvBase64url.length !== 16 ||
    typeof bootstrapCiphertextBase64url !== 'string' ||
    bootstrapCiphertextBase64url.length < 64 ||
    bootstrapCiphertextBase64url.length > 4_096
  ) {
    throw new RelayError(
      'Die sichere Sitzung ist unvollständig oder ungültig.',
      false,
      'invalid-bootstrap',
    );
  }

  let iv;
  let ciphertext;
  const aad = new TextEncoder().encode(
    `${STATIC_BOOTSTRAP_AAD_DOMAIN}${stationId}|${sessionId}|documents-v2`,
  );
  let plaintext;
  try {
    iv = base64urlToBytes(bootstrapIvBase64url);
    ciphertext = base64urlToBytes(bootstrapCiphertextBase64url);
    if (iv.length !== 12 || ciphertext.length < 32) {
      throw new Error('invalid-bootstrap-size');
    }
    plaintext = new Uint8Array(
      await cryptoApi.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: aad,
          tagLength: 128,
        },
        key,
        ciphertext,
      ),
    );
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(plaintext),
    );
  } catch {
    throw new RelayError(
      'Die sichere Sitzung konnte nicht entschlüsselt werden.',
      false,
      'invalid-bootstrap',
    );
  } finally {
    iv?.fill(0);
    ciphertext?.fill(0);
    plaintext?.fill(0);
    aad.fill(0);
  }
}

export async function prepareEncryptedCapture({
  key,
  sessionId,
  phoneSession,
  side,
  protocolVersion = '1',
  jpegBytes,
  width,
  height,
  capturedAt = new Date().toISOString(),
  cryptoApi = globalThis.crypto,
  fixedIv,
}) {
  if (protocolVersion !== '1' && protocolVersion !== '2') {
    jpegBytes.fill(0);
    throw new TypeError('Die Scan-Protokollversion ist ungültig.');
  }
  const schemaVersion = Number(protocolVersion);
  const header = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion,
      sessionId,
      side,
      mime: 'image/jpeg',
      width,
      height,
      capturedAt,
      consent: { accepted: true, textVersion: CONSENT_VERSION },
    }),
  );
  const plain = new Uint8Array(4 + header.length + jpegBytes.length);
  new DataView(plain.buffer).setUint32(0, header.length, false);
  plain.set(header, 4);
  plain.set(jpegBytes, 4 + header.length);
  const iv = fixedIv
    ? Uint8Array.from(fixedIv)
    : cryptoApi.getRandomValues(new Uint8Array(12));
  if (iv.length !== 12) {
    plain.fill(0);
    header.fill(0);
    jpegBytes.fill(0);
    iv.fill(0);
    throw new TypeError('Der AES-GCM-Initialisierungsvektor ist ungültig.');
  }
  const aad = new TextEncoder().encode(
    `SN-ID-CAPTURE/v${protocolVersion}|${sessionId}|${side}`,
  );
  let ciphertext;
  let digest;
  try {
    ciphertext = new Uint8Array(
      await cryptoApi.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
        key,
        plain,
      ),
    );
    if (ciphertext.length > MAX_CIPHERTEXT_BYTES) {
      ciphertext.fill(0);
      throw new Error(
        'Die Aufnahme ist zu groß. Bitte den Ausweis etwas näher aufnehmen.',
      );
    }
    digest = new Uint8Array(
      await cryptoApi.subtle.digest('SHA-256', ciphertext),
    );
    const base64 = bytesToBase64(ciphertext);
    const chunks = [];
    for (let offset = 0; offset < base64.length; offset += CHUNK_CHARACTERS) {
      chunks.push(base64.slice(offset, offset + CHUNK_CHARACTERS));
    }
    return {
      side,
      ciphertext,
      chunks,
      manifest: {
        sessionId,
        phoneSession,
        side,
        totalChunks: chunks.length,
        sizeBytes: ciphertext.length,
        ciphertextSha256: hex(digest),
        ivBase64url: bytesToBase64url(iv),
      },
    };
  } finally {
    plain.fill(0);
    header.fill(0);
    jpegBytes.fill(0);
    aad.fill(0);
    iv.fill(0);
    if (digest) digest.fill(0);
  }
}

export function disposePreparedCapture(prepared) {
  if (!prepared) return;
  prepared.ciphertext?.fill(0);
  prepared.chunks?.fill('');
  if (prepared.manifest) {
    prepared.manifest.phoneSession = '';
    prepared.manifest.ciphertextSha256 = '';
    prepared.manifest.ivBase64url = '';
  }
}
