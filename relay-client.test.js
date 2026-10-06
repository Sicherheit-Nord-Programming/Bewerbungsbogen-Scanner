import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bytesToBase64url,
  callRelay,
  decryptStaticBootstrap,
  disposePreparedCapture,
  importCaptureKey,
  importStaticPairingKey,
  prepareEncryptedCapture,
  waitForStaticSession,
} from './relay-client.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

test('HTTP relay uses the preflight-free envelope contract exactly', async () => {
  let observed;
  const payload = await callRelay(
    'https://script.google.com/macros/s/example/exec',
    'claim',
    { sessionId: SESSION_ID, uploadCapability: 'u', phoneSession: 'p' },
    {
      fetchImpl: async (url, options) => {
        observed = { url, options };
        return new Response(
          JSON.stringify({
            schemaVersion: 1,
            action: 'claim',
            status: 'claimed',
            expiresAt: 1_900_000_000_000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    },
  );
  assert.equal(payload.status, 'claimed');
  assert.equal(observed.url, 'https://script.google.com/macros/s/example/exec');
  assert.equal(observed.options.method, 'POST');
  assert.equal(observed.options.redirect, 'follow');
  assert.equal(observed.options.credentials, 'omit');
  assert.deepEqual(observed.options.headers, {
    'Content-Type': 'text/plain;charset=UTF-8',
  });
  assert.deepEqual(JSON.parse(observed.options.body), {
    schemaVersion: 1,
    action: 'claim',
    request: {
      sessionId: SESSION_ID,
      uploadCapability: 'u',
      phoneSession: 'p',
    },
  });
});

test('static station discovery polls only while waiting and returns the available bootstrap', async () => {
  const stationId = 'a'.repeat(64);
  const responses = [
    {
      schemaVersion: 1,
      action: 'discover',
      status: 'waiting',
    },
    {
      schemaVersion: 1,
      action: 'discover',
      status: 'available',
      sessionId: SESSION_ID,
      expiresAt: 1_900_000_000_000,
      bootstrapIvBase64url: 'A'.repeat(16),
      bootstrapCiphertextBase64url: 'B'.repeat(64),
    },
  ];
  const requests = [];
  const waits = [];
  const result = await waitForStaticSession(
    'https://script.google.com/macros/s/example/exec',
    stationId,
    {
      fetchImpl: async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return new Response(JSON.stringify(responses.shift()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
      waitImpl: async (milliseconds) => waits.push(milliseconds),
    },
  );
  assert.equal(result.status, 'available');
  assert.equal(result.sessionId, SESSION_ID);
  assert.deepEqual(waits, [1_500]);
  assert.deepEqual(requests, [
    {
      schemaVersion: 1,
      action: 'discover',
      request: { stationId },
    },
    {
      schemaVersion: 1,
      action: 'discover',
      request: { stationId },
    },
  ]);
});

test('static bootstrap decrypts only with station, session and documents-v2 AAD', async () => {
  const stationId = 'a'.repeat(64);
  const pairingBytes = Uint8Array.from(
    { length: 32 },
    (_value, index) => index + 1,
  );
  const encryptionKeyBytes = Uint8Array.from(pairingBytes);
  const pairingKey = await importStaticPairingKey(pairingBytes);
  assert.ok(pairingBytes.every((byte) => byte === 0));
  const encryptionKey = await crypto.subtle.importKey(
    'raw',
    encryptionKeyBytes,
    'AES-GCM',
    false,
    ['encrypt'],
  );
  encryptionKeyBytes.fill(0);
  const payload = {
    v: '2',
    s: SESSION_ID,
    u: 'U'.repeat(43),
    k: 'K'.repeat(43),
    e: 'https://script.google.com/macros/s/example/exec',
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const iv = Uint8Array.from({ length: 12 }, (_value, index) => index + 3);
  const aad = new TextEncoder().encode(
    `SN-ID-STATIC-BOOTSTRAP/v1|${stationId}|${SESSION_ID}|documents-v2`,
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
      encryptionKey,
      plaintext,
    ),
  );
  const decrypted = await decryptStaticBootstrap({
    key: pairingKey,
    stationId,
    sessionId: SESSION_ID,
    bootstrapIvBase64url: bytesToBase64url(iv),
    bootstrapCiphertextBase64url: bytesToBase64url(ciphertext),
  });
  assert.deepEqual(decrypted, payload);

  const legacyAad = new TextEncoder().encode(
    `SN-ID-STATIC-BOOTSTRAP/v1|${stationId}|${SESSION_ID}`,
  );
  const legacyCiphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: legacyAad,
        tagLength: 128,
      },
      encryptionKey,
      plaintext,
    ),
  );
  await assert.rejects(
    decryptStaticBootstrap({
      key: pairingKey,
      stationId,
      sessionId: SESSION_ID,
      bootstrapIvBase64url: bytesToBase64url(iv),
      bootstrapCiphertextBase64url: bytesToBase64url(legacyCiphertext),
    }),
    (error) => error?.code === 'invalid-bootstrap',
  );
  plaintext.fill(0);
  iv.fill(0);
  aad.fill(0);
  legacyAad.fill(0);
  ciphertext.fill(0);
  legacyCiphertext.fill(0);
});

test('AES-GCM payload decrypts to the versioned header and exact JPEG bytes', async () => {
  const keyBytes = Uint8Array.from({ length: 32 }, (_value, index) => index);
  const decryptKeyBytes = Uint8Array.from(keyBytes);
  const key = await importCaptureKey(keyBytes);
  assert.ok(keyBytes.every((byte) => byte === 0));
  const decryptKey = await crypto.subtle.importKey(
    'raw',
    decryptKeyBytes,
    'AES-GCM',
    false,
    ['decrypt'],
  );
  decryptKeyBytes.fill(0);
  const jpegBytes = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const expectedJpeg = Uint8Array.from(jpegBytes);
  const iv = Uint8Array.from({ length: 12 }, (_value, index) => index + 1);
  const prepared = await prepareEncryptedCapture({
    key,
    sessionId: SESSION_ID,
    phoneSession: 'P'.repeat(43),
    side: 'front',
    jpegBytes,
    width: 1_600,
    height: 1_009,
    capturedAt: '2026-09-29T10:00:00.000Z',
    fixedIv: iv,
  });
  assert.ok(jpegBytes.every((byte) => byte === 0));
  const aad = new TextEncoder().encode(`SN-ID-CAPTURE/v1|${SESSION_ID}|front`);
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: aad,
        tagLength: 128,
      },
      decryptKey,
      prepared.ciphertext,
    ),
  );
  const headerLength = new DataView(
    plaintext.buffer,
    plaintext.byteOffset,
    plaintext.byteLength,
  ).getUint32(0, false);
  const header = JSON.parse(
    new TextDecoder().decode(plaintext.subarray(4, 4 + headerLength)),
  );
  assert.equal(header.schemaVersion, 1);
  assert.equal(header.sessionId, SESSION_ID);
  assert.equal(header.side, 'front');
  assert.equal(header.mime, 'image/jpeg');
  assert.deepEqual(plaintext.subarray(4 + headerLength), expectedJpeg);
  plaintext.fill(0);
  aad.fill(0);
  disposePreparedCapture(prepared);
  assert.ok(prepared.ciphertext.every((byte) => byte === 0));
  assert.ok(prepared.chunks.every((chunk) => chunk === ''));
});

test('version-2 capture binds the document slot into the v2 header and AAD', async () => {
  const keyBytes = Uint8Array.from(
    { length: 32 },
    (_value, index) => 31 - index,
  );
  const decryptKeyBytes = Uint8Array.from(keyBytes);
  const key = await importCaptureKey(keyBytes);
  const decryptKey = await crypto.subtle.importKey(
    'raw',
    decryptKeyBytes,
    'AES-GCM',
    false,
    ['decrypt'],
  );
  decryptKeyBytes.fill(0);
  const iv = Uint8Array.from({ length: 12 }, (_value, index) => index + 9);
  const prepared = await prepareEncryptedCapture({
    key,
    sessionId: SESSION_ID,
    phoneSession: 'P'.repeat(43),
    side: 'passport-data',
    protocolVersion: '2',
    jpegBytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
    width: 1_600,
    height: 1_126,
    capturedAt: '2026-10-05T10:00:00.000Z',
    fixedIv: iv,
  });
  const aad = new TextEncoder().encode(
    `SN-ID-CAPTURE/v2|${SESSION_ID}|passport-data`,
  );
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: aad,
        tagLength: 128,
      },
      decryptKey,
      prepared.ciphertext,
    ),
  );
  const headerLength = new DataView(plaintext.buffer).getUint32(0, false);
  const header = JSON.parse(
    new TextDecoder().decode(plaintext.subarray(4, 4 + headerLength)),
  );
  assert.equal(header.schemaVersion, 2);
  assert.equal(header.side, 'passport-data');
  plaintext.fill(0);
  aad.fill(0);
  disposePreparedCapture(prepared);
});
