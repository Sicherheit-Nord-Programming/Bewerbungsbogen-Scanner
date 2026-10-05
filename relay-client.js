const CHUNK_CHARACTERS = 64 * 1024;
const MAX_CIPHERTEXT_BYTES = 8 * 1024 * 1024;
const CONSENT_VERSION = 'id-copy-consent-de-v1';

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
          'Die sichere Sitzung konnte nicht fortgesetzt werden.',
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
