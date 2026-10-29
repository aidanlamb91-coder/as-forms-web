/**
 * 1.1.0-web — Cloud sign-in settings. THE ONLY FILE TO EDIT WHEN THE OAUTH CLIENTS EXIST.
 *
 * Replace the two placeholder values below, save, redeploy. Until then the Connect buttons
 * say "Cloud sign-in is not set up yet" and nothing else changes.
 *
 * googleClientId  — a Google Cloud OAuth client of type "Web application", created in the
 *                   SAME Google Cloud project as the Android client (so Drive treats web and
 *                   Android as one app and both can see the "AS Forms" folder's files).
 *                   Looks like 123456789-abc….apps.googleusercontent.com
 * oneDriveClientId — the Application (client) ID of the EXISTING Azure app that the Android
 *                   app uses, after a "Single-page application" platform is added to it with the
 *                   redirect URI below (same app = same OneDrive app folder as Android).
 *
 * Client IDs are not secrets (they are visible in any app that uses them). No client secret is
 * used or needed anywhere in the web app.
 *
 * Redirect URI = this page's own address (folder), e.g.
 *   https://aidanlamb91-coder.github.io/as-forms-web/beta/   (beta)
 *   https://aidanlamb91-coder.github.io/as-forms-web/        (main site, after promotion)
 */
(function (global) {
  const PLACEHOLDER_GOOGLE = 'PASTE-GOOGLE-WEB-CLIENT-ID.apps.googleusercontent.com';
  const PLACEHOLDER_ONEDRIVE = 'PASTE-AZURE-APPLICATION-CLIENT-ID';

  const config = {
    googleClientId: '698136732826-r6hg6ojjlsg20uvbs1b62hrmtrm61uvf.apps.googleusercontent.com', // Web client, project as-forms-510718 (no secret: browser flow)
    oneDriveClientId: '9c085b40-0d03-49db-8652-2a0a90f9b8a4', // same Azure app as Android (SPA platform)
    // 1.2.2-web build 5: Worker that keeps Google signed in for weeks (holds the client secret; see worker/).
    googleTokenWorker: 'https://as-forms-auth.aidanlamb91.workers.dev',
  };

  /** This page's folder address, used as the OAuth redirect URI (no file name, no ?query or #hash). */
  function redirectUri() {
    const loc = global.location;
    return loc.origin + loc.pathname.replace(/[^/]*$/, '');
  }

  /** True when a real ID has been pasted in (not the placeholder, not blank). */
  function isConfigured(kind) {
    const id = kind === 'google' ? config.googleClientId : config.oneDriveClientId;
    return !!id && !/^PASTE-/.test(id);
  }

  global.AsCloudConfig = { config, redirectUri, isConfigured };
})(typeof window !== 'undefined' ? window : globalThis);
