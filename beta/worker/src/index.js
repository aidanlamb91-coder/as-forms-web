// AS Forms auth Worker (free tier). Keeps Google Drive signed in for weeks on the web app.
// POST /google/code    {code, redirect_uri} -> {access_token, expires_in, rt}
// POST /google/refresh {rt}                 -> {access_token, expires_in}  (401 {error:'invalid_grant'} = sign in again)
// rt = the Google refresh token, AES-GCM encrypted with RT_KEY. Only this Worker can read it;
// nothing is stored here. The client secret lives only in Worker secrets.
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
const json = (o, status, h) => new Response(JSON.stringify(o), { status, headers: { ...h, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function key(env) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.RT_KEY));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(text));
  return b64u(iv) + '.' + b64u(ct);
}
async function open(env, rt) {
  const [iv, ct] = String(rt || '').split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await key(env), unb64u(ct));
  return new TextDecoder().decode(pt);
}
async function google(env, params) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  let j = {};
  try { j = await r.json(); } catch (_) {}
  return { status: r.status, j };
}

export default {
  async fetch(request, env) {
    const h = cors(env);
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: origin === env.ALLOWED_ORIGIN ? 204 : 403, headers: h });
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/') return json({ ok: true, service: 'as-forms-auth' }, 200, h);
    if (request.method !== 'POST') return json({ error: 'not_found' }, 404, h);
    if (origin !== env.ALLOWED_ORIGIN) return json({ error: 'origin_not_allowed' }, 403, h);
    let body;
    try { body = await request.json(); } catch (_) { return json({ error: 'bad_json' }, 400, h); }

    if (path === '/google/code') {
      const redirect = String(body.redirect_uri || '');
      if (!body.code || !redirect.startsWith(env.ALLOWED_ORIGIN + '/')) return json({ error: 'bad_request' }, 400, h);
      const { status, j } = await google(env, { grant_type: 'authorization_code', code: String(body.code), redirect_uri: redirect });
      if (status !== 200 || !j.access_token) return json({ error: j.error || 'exchange_failed' }, status === 200 ? 502 : 400, h);
      return json({ access_token: j.access_token, expires_in: j.expires_in, rt: j.refresh_token ? await seal(env, j.refresh_token) : null }, 200, h);
    }
    if (path === '/google/refresh') {
      let refresh;
      try { refresh = await open(env, body.rt); } catch (_) { return json({ error: 'invalid_grant' }, 401, h); }
      const { status, j } = await google(env, { grant_type: 'refresh_token', refresh_token: refresh });
      if (status === 200 && j.access_token) return json({ access_token: j.access_token, expires_in: j.expires_in }, 200, h);
      if (j.error === 'invalid_grant') return json({ error: 'invalid_grant' }, 401, h);
      return json({ error: j.error || 'refresh_failed' }, 502, h);
    }
    return json({ error: 'not_found' }, 404, h);
  },
};
