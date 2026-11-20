import fs from 'fs';
import path from 'path';
import sodium from 'libsodium-wrappers';
import {
  buildSubmissionBody, fetchPublicKey, sealDonation, summarize,
} from './encryptDonation';

// Test-only keypair and messages shared with the server's tests (no real secrets).
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, '../../server/tests/fixtures/xlang.json'), 'utf8'));

const b64 = (s) => sodium.from_base64(s, sodium.base64_variants.ORIGINAL);
const open = async (sealedB64) => {
  await sodium.ready;
  return sodium.to_string(sodium.crypto_box_seal_open(b64(sealedB64), b64(FIXTURE.pk), b64(FIXTURE.sk)));
};

const pkg = () => ({
  submissionId: '1234567890123456',
  platform: 'googletakeout',
  data: { 'Google Fit - Raw Steps': [{ a: 1 }, { a: 2 }], 'YouTube - Daily Activity': [{ b: 'x' }] },
});
const jsonResponse = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });

describe('summarize', () => {
  test('counts rows per table and in total', () => {
    expect(summarize(pkg().data)).toEqual({ tables: { 'Google Fit - Raw Steps': 2, 'YouTube - Daily Activity': 1 }, totalRows: 3 });
    expect(summarize(undefined)).toEqual({ tables: {}, totalRows: 0 });
  });
});

describe('sealDonation', () => {
  test('round-trips through libsodium and carries the enc:v1: prefix', async () => {
    const sealed = await sealDonation(pkg(), FIXTURE.pk);
    expect(sealed.startsWith('enc:v1:')).toBe(true);
    expect(JSON.parse(await open(sealed.slice('enc:v1:'.length)))).toEqual(pkg());
  });

  test('every ciphertext is different (ephemeral key) and 48 bytes longer than the plaintext', async () => {
    const a = await sealDonation(pkg(), FIXTURE.pk);
    const b = await sealDonation(pkg(), FIXTURE.pk);
    expect(a).not.toEqual(b);
    const plainLen = sodium.from_string(JSON.stringify(pkg())).length;
    expect(b64(a.slice('enc:v1:'.length)).length).toBe(plainLen + 48);
  });

  test('opens a ciphertext produced by PyNaCl (the server-side/Python implementation)', async () => {
    expect(await open(FIXTURE.py_ct)).toBe(FIXTURE.msg);
  });

  test('the JS-sealed fixture the Python suite decrypts is itself valid here', async () => {
    expect(await open(FIXTURE.js_enc.slice('enc:v1:'.length))).toBe(FIXTURE.msg);
  });

  test('rejects a public key of the wrong size', async () => {
    await expect(sealDonation(pkg(), 'AAAA')).rejects.toThrow(/not valid/);
  });
});

describe('fetchPublicKey', () => {
  test('returns the key from the health response', async () => {
    expect(await fetchPublicKey('/s', jsonResponse({ ok: true, publicKey: FIXTURE.pk }))).toBe(FIXTURE.pk);
  });

  test.each([
    [jsonResponse({ ok: true })],
    [jsonResponse({ publicKey: '' })],
    [jsonResponse({}, false, 503)],
  ])('throws when there is no usable key (%#)', async (fetchImpl) => {
    await expect(fetchPublicKey('/s', fetchImpl)).rejects.toThrow();
  });
});

describe('buildSubmissionBody', () => {
  test('flag off: exactly the plaintext body used before, and no key request', async () => {
    const fetchImpl = jest.fn();
    const body = await buildSubmissionBody({ platformId: 'googletakeout', donationPackage: pkg(), fetchImpl });
    expect(JSON.parse(body)).toEqual({ platform: 'googletakeout', donation: pkg() });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('flag on: an envelope with a summary and a sealed payload, and no plaintext data anywhere', async () => {
    const body = await buildSubmissionBody({
      platformId: 'googletakeout', donationPackage: pkg(), encryptInBrowser: true, submitUrl: '/s',
      fetchImpl: jsonResponse({ ok: true, publicKey: FIXTURE.pk }),
    });
    const parsed = JSON.parse(body);
    expect(Object.keys(parsed).sort()).toEqual(['encrypted', 'platform']);
    expect(parsed.encrypted).toMatchObject({
      v: 1, submissionId: '1234567890123456', summary: { totalRows: 3, tables: { 'Google Fit - Raw Steps': 2, 'YouTube - Daily Activity': 1 } },
    });
    expect(body).not.toContain('"a":1');
    expect(JSON.parse(await open(parsed.encrypted.payload.slice('enc:v1:'.length)))).toEqual(pkg());
  });

  test('flag on and no key: throws, so the caller cannot fall back to plaintext', async () => {
    await expect(buildSubmissionBody({
      platformId: 'googletakeout', donationPackage: pkg(), encryptInBrowser: true, submitUrl: '/s', fetchImpl: jsonResponse({ ok: true }),
    })).rejects.toThrow();
  });
});
