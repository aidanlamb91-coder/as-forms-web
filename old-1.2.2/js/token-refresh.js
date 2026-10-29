/**
 * 1.1.0-web — Sign-in renewal rules (port of Android sync/TokenRefresh.kt). Pure, unit tested.
 *
 * In plain English:
 *  - A cloud "access token" lasts about an hour. Renew it 5 minutes BEFORE it runs out.
 *  - If the cloud still answers "401 not signed in", renew once and try the same call again.
 *  - If renewing is refused for good ("invalid_grant": sign-in revoked or expired), stop and
 *    show "Sign in again" instead of raw error text.
 *  - A network blip while renewing is NOT treated as signed out; sync just fails and retries later.
 */
(function (global) {
  const EARLY_MS = 5 * 60 * 1000;

  /** True when the token is missing, expired, or about to expire (or when forced). */
  function needsRefresh(access, expiresAt, now, force) {
    return !!force || !access || (expiresAt != null && expiresAt <= now + EARLY_MS);
  }

  /** Google and Microsoft both reply 400 {"error":"invalid_grant"} when a refresh token is dead. */
  function isInvalidGrant(code, body) {
    let err = '';
    try { err = String(JSON.parse(body).error || ''); } catch (_) { /* not JSON */ }
    err = err.toLowerCase();
    return err === 'invalid_grant' || err === 'unauthorized_client' || err === 'interaction_required' ||
      err === 'login_required' || err === 'consent_required' ||
      (code === 400 && /invalid_grant/i.test(String(body || '')));
  }

  /**
   * Turn the token server's reply into one of:
   *   { type:'renewed', access, refresh, expiresAt }  |  { type:'signInRequired' }  |  { type:'failed', message }
   * post() returns { status, body } or throws on a network error.
   */
  async function renew(refreshToken, now, post) {
    if (!refreshToken) return { type: 'signInRequired' };
    let r;
    try { r = await post(); } catch (e) {
      return { type: 'failed', message: (e && e.message) || 'Network error while renewing sign-in' };
    }
    if (r.status >= 200 && r.status < 300) {
      let j;
      try { j = JSON.parse(r.body); } catch (_) { return { type: 'failed', message: 'Bad reply from sign-in server' }; }
      if (!j.access_token) return { type: 'failed', message: 'Sign-in server gave no access token' };
      return {
        type: 'renewed',
        access: j.access_token,
        refresh: j.refresh_token || refreshToken, // Microsoft rotates it; Google keeps the old one
        expiresAt: now + (Number(j.expires_in) || 3600) * 1000,
      };
    }
    return isInvalidGrant(r.status, r.body) ? { type: 'signInRequired' }
      : { type: 'failed', message: 'Sign-in renewal failed (HTTP ' + r.status + ')' };
  }

  /** Thrown by a provider request when the cloud answers 401. */
  class Unauthorized extends Error { constructor(body) { super('HTTP 401'); this.body = body; } }
  /** The user must sign in again (shown as the "Sign in again" button). */
  class SignInRequired extends Error { constructor(kind) { super('Sign-in has expired'); this.kind = kind; } }

  /** Run call(token) with the "renew once and retry on 401" rule. token(force) gives a token. */
  async function withAuthRetry(kind, token, call) {
    try {
      return await call(await token(false));
    } catch (e) {
      if (!(e instanceof Unauthorized)) throw e;
      try {
        return await call(await token(true));
      } catch (e2) {
        if (e2 instanceof Unauthorized) throw new SignInRequired(kind);
        throw e2;
      }
    }
  }

  global.AsTokenRefresh = { EARLY_MS, needsRefresh, isInvalidGrant, renew, withAuthRetry, Unauthorized, SignInRequired };
})(typeof window !== 'undefined' ? window : globalThis);
