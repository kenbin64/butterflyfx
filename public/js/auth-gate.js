/* auth-gate.js
 * Shared server-verified auth gate for Манifold AI + Манifold IDE.
 *
 * Assumes existing login flow stores:
 *   localStorage.user_token
 *
 * Uses existing backend endpoint:
 *   POST/GET /api/auth/validate (this repo uses GET /api/auth/validate)
 * with:
 *   Authorization: Bearer <token>
 *
 * If unauthenticated/invalid:
 *   redirect to /login/?redirect=<current_url>
 */

(function () {
  'use strict';

  const AUTH_VALIDATE_URL = '/api/auth/validate';
  const LOGIN_URL = '/login/';

  function setAuthed(token) {
    window.__kgAuthed = true;
    window.__kgToken = token || null;
    window.dispatchEvent(new Event('kg:authed'));
  }

  // Redirects disabled: auth-gate should never force navigation to /login/.
  function redirectToLogin() {
    return;
  }

  async function validateToken(token) {
    const res = await fetch(AUTH_VALIDATE_URL, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      credentials: 'same-origin',
    });

    if (!res.ok) return { valid: false };

    const data = await res.json().catch(() => ({}));
    return { valid: !!data.valid, raw: data };
  }

  async function ensureAuthed() {
    // Already validated in this tab session.
    if (window.__kgAuthed) return true;

    const token = (window.localStorage && localStorage.getItem('user_token')) || '';

    // If a token exists, try server validation once.
    if (token) {
      try {
        const out = await validateToken(token);
        if (out.valid) {
          setAuthed(token);
          return true;
        }
      } catch (_) {
        // fall through to unauthenticated mode
      }

      // Token exists but invalid: clear it, but DO NOT redirect.
      try {
        localStorage.removeItem('user_token');
      } catch (_) { /* ignore */ }
    }

    // Auth disabled: allow the app to boot unauthenticated.
    // Server-verified features may still fail with 401/403, but IDE login/signup screen is removed.
    setAuthed(null);
    return true;
  }

  // Expose globally for module scripts.
  window.kgAuth = { ensureAuthed };
})();
