// Calls to the Webwriter server. Changes carry a custom header, so only this page can make them.

async function request(method, url, body, raw = false) {
  const headers = { 'X-Webwriter': '1' };
  let payload;
  if (raw) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(url, { method, headers, body: payload, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  upload: (url, blob) => request('POST', url, blob, true),
};
