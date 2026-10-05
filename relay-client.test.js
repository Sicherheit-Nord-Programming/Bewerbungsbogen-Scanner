import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  callRelay,
  disposePreparedCapture,
  importCaptureKey,
  prepareEncryptedCapture,
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
