// ═══════════════════════════════════════════════════════════════
//  spire-api.js — shared Worker fetch helpers.
//
//  Load AFTER auth.js (depends on window.Auth):
//    <script src="auth.js?v=2"></script>
//    <script src="spire-api.js?v=1"></script>
//
//  Exposes window.API:
//    WORKER_URL          — canonical Worker endpoint (from Auth)
//    get(type)           — anonymous GET, throws on !ok
//    dmGet(type)         — DM-authenticated GET, throws on !ok
//    dmPost(type, payload) — DM-authenticated POST; never throws,
//                            returns { ok, status, body }
//
//  Non-standard POST shapes (auth flows, crucible runs) should keep
//  using raw fetch — don't force-fit them through these helpers.
// ═══════════════════════════════════════════════════════════════
(function () {
  const WORKER_URL = (window.Auth && window.Auth.WORKER_URL)
    || 'https://dnd-perk-webhook.jacobgiff.workers.dev/';

  async function get(type) {
    const res = await fetch(`${WORKER_URL}?type=${encodeURIComponent(type)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`GET ${type} failed: HTTP ${res.status}`);
    return res.json();
  }

  async function dmGet(type) {
    const res = await fetch(`${WORKER_URL}?type=${encodeURIComponent(type)}`, {
      cache: 'no-store',
      headers: Auth.dmHeaders(),
    });
    if (!res.ok) {
      const err = new Error(`GET ${type} failed: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async function dmPost(type, payload) {
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: Auth.dmHeaders(),
        body: JSON.stringify({ type, payload }),
      });
      let body = null;
      try { body = await res.json(); } catch {}
      return { ok: res.ok, status: res.status, body };
    } catch (e) {
      return { ok: false, status: 0, body: { error: e.message } };
    }
  }

  window.API = { WORKER_URL, get, dmGet, dmPost };
})();
