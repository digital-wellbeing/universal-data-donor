/**
 * Browser-side encryption of a donation (opt-in: `general.encryptInBrowser` in the
 * platform config; OFF by default).
 *
 * With it ON, the package is sealed in the participant's browser to the study's
 * public key (libsodium `crypto_box_seal`, the same construction PyNaCl's
 * SealedBox uses), so the server and the host never see plaintext: only the
 * offline private key can read it. The output is the stored format the server's
 * own encryption already produces ("enc:v1:" + base64), so the existing decrypt
 * tooling (server/donation_crypto.py) opens it unchanged.
 *
 * Trade-off: the server cannot validate the contents of an encrypted donation. It
 * validates the envelope (known platform, 16-digit id, size) and a client-reported
 * summary of table names and row counts; the contents can only be checked after
 * decryption.
 *
 * It fails closed: if the key cannot be fetched or sealing fails, this throws and
 * the caller must NOT fall back to sending plaintext.
 */

const PREFIX = 'enc:v1:';

/**
 * Row counts per table, for the envelope summary.
 * @param {Object<string, Object[]>} data
 * @returns {{tables: Object<string, number>, totalRows: number}}
 */
export const summarize = (data) => {
  const tables = {};
  let totalRows = 0;
  Object.entries(data || {}).forEach(([name, rows]) => {
    tables[name] = rows.length;
    totalRows += rows.length;
  });
  return { tables, totalRows };
};

/**
 * The study's public key, served by the API's health endpoint (single source of
 * truth: the same key the server encrypts with, so nothing is hard-coded here).
 * @param {string} submitUrl
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string>} base64 X25519 public key
 */
export const fetchPublicKey = async (submitUrl, fetchImpl = fetch) => {
  const response = await fetchImpl(submitUrl, { method: 'GET', cache: 'no-store' });
  if (!response.ok) throw new Error(`public key request failed (${response.status})`);
  const body = await response.json();
  if (typeof body.publicKey !== 'string' || !body.publicKey) throw new Error('the server did not provide a public key');
  return body.publicKey;
};

/**
 * Seal a donation package to `publicKeyB64`.
 * @param {Object} donationPackage
 * @param {string} publicKeyB64
 * @returns {Promise<string>} "enc:v1:" + base64(sealed box of the package JSON)
 */
export const sealDonation = async (donationPackage, publicKeyB64) => {
  // Loaded on demand: participants of platforms without the flag never download it.
  const mod = await import('libsodium-wrappers');
  const sodium = mod.default || mod;
  await sodium.ready;
  const publicKey = sodium.from_base64(publicKeyB64, sodium.base64_variants.ORIGINAL);
  if (publicKey.length !== sodium.crypto_box_PUBLICKEYBYTES) throw new Error('the public key is not valid');
  const sealed = sodium.crypto_box_seal(sodium.from_string(JSON.stringify(donationPackage)), publicKey);
  return PREFIX + sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
};

/**
 * The JSON string to POST to /datadonation/submit.
 *
 * Flag off: exactly the plaintext body used so far. Flag on: an encrypted envelope.
 *
 * @param {Object} options
 * @param {string} options.platformId
 * @param {Object} options.donationPackage
 * @param {boolean} [options.encryptInBrowser]
 * @param {string} [options.submitUrl] required when encryptInBrowser is set
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<string>}
 */
export const buildSubmissionBody = async ({
  platformId, donationPackage, encryptInBrowser = false, submitUrl, fetchImpl,
}) => {
  if (!encryptInBrowser) return JSON.stringify({ platform: platformId, donation: donationPackage });

  const publicKey = await fetchPublicKey(submitUrl, fetchImpl);
  const payload = await sealDonation(donationPackage, publicKey);
  return JSON.stringify({
    platform: platformId,
    encrypted: {
      v: 1,
      submissionId: donationPackage.submissionId,
      summary: summarize(donationPackage.data),
      payload,
    },
  });
};
