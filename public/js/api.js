async function call(method, url, body, opts = {}) {
  const raw = body instanceof Blob || body instanceof ArrayBuffer;
  let res;
  try { res = await fetch(url, {
    method,
    credentials: 'same-origin',
    keepalive: opts.keepalive,
    headers: { 'X-DW': '1', ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
    body: body == null ? undefined : raw ? body : JSON.stringify(body),
  }); } catch { const e = new Error('Liaison perdue (squawk 7600) : vérifiez votre connexion.'); e.status = 0; throw e; }
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error(data?.error || `Erreur ${res.status}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (u) => call('GET', u),
  post: (u, b) => call('POST', u, b ?? {}),
  put: (u, b, o) => call('PUT', u, b, o),
  patch: (u, b) => call('PATCH', u, b),
  del: (u) => call('DELETE', u),
  async upload(file) {
    return call('POST', '/api/files', file, { headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) } });
  },
  async importZip(file) {
    return call('POST', '/api/import/zip', file, { headers: { 'Content-Type': 'application/zip' } });
  },
};
