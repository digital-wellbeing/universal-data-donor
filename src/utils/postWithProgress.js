/**
 * POST a JSON string and report upload progress (fetch cannot do this).
 *
 * @param {string} url
 * @param {string} body - already-serialised JSON
 * @param {string} turnstileToken - sent as the CF-Turnstile-Response header so the
 *   server can verify it before reading the body
 * @param {(loaded: number, total: number) => void} onProgress
 * @returns {Promise<{status: number, json: Object}>} resolves for any HTTP
 *   response (json is {} if the body is not JSON); rejects on network failure.
 */
export default function postWithProgress(url, body, turnstileToken, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('CF-Turnstile-Response', turnstileToken);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      let json = {};
      try {
        json = JSON.parse(xhr.responseText);
      } catch (e) {
        // Non-JSON error body (e.g. a proxy 413 page): caller falls back to status.
      }
      resolve({ status: xhr.status, json });
    };
    xhr.onerror = () => reject(new Error('network'));
    xhr.onabort = () => reject(new Error('aborted'));
    xhr.send(body);
  });
}
