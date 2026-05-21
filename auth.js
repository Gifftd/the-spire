// ═══════════════════════════════════════════════════════════════
//  auth.js — single source of truth for identity across pages.
//  Every page includes this and uses window.Auth.
//
//  Roles:
//    'dm'        — DM account (username + password validated by worker)
//    'player'    — claimed a character with their code
//    'anonymous' — no creds; can still view public pages
//
//  Storage shape (localStorage 'campaign-perks-auth'):
//    {
//      role: 'dm' | 'player' | null,
//      dm:     { username, password }       (when role='dm')
//      player: { characterId, code, name }  (when role='player')
//    }
//
//  IMPORTANT: client-side role gating is for UX only. The worker
//  re-validates DM creds on every protected write, and player_view
//  re-validates the player code on every fetch.
// ═══════════════════════════════════════════════════════════════
(function () {
  const KEY = 'campaign-perks-auth';
  // Pages can override window.WORKER_URL before including auth.js;
  // otherwise we point at the deployed default.
  const WORKER_URL = (typeof window !== 'undefined' && window.WORKER_URL)
    || 'https://dnd-perk-webhook.jacobgiff.workers.dev/';

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; }
    catch { return {}; }
  }
  function write(state) { localStorage.setItem(KEY, JSON.stringify(state)); }
  function clear() { localStorage.removeItem(KEY); }

  function getRole() {
    const s = read();
    if (s.role === 'dm' && s.dm) return 'dm';
    if (s.role === 'player' && s.player) return 'player';
    return 'anonymous';
  }

  function identity() {
    const s = read();
    if (s.role === 'dm' && s.dm)         return { role: 'dm',     name: s.dm.username,    display: 'DM · ' + s.dm.username };
    if (s.role === 'player' && s.player) return { role: 'player', name: s.player.name,    display: s.player.name };
    return { role: 'anonymous', name: '', display: 'Visitor' };
  }

  // ── DM auth ───────────────────────────────────────────────────
  async function dmStatus() {
    try {
      const r = await fetch(WORKER_URL + '?type=dm_status', { cache: 'no-store' });
      if (!r.ok) return { configured: false, error: true };
      return await r.json();
    } catch { return { configured: false, error: true }; }
  }

  async function dmSetup(username, password, masterToken) {
    const r = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DM-Token': masterToken || '' },
      body: JSON.stringify({ type: 'dm_setup', username, password })
    });
    let body = {}; try { body = await r.json(); } catch {}
    if (!r.ok || !body.ok) return { ok: false, error: body.error || ('HTTP ' + r.status) };
    return { ok: true };
  }

  async function dmLogin(username, password) {
    const r = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'dm_login', username, password })
    });
    let body = {}; try { body = await r.json(); } catch {}
    if (!r.ok || !body.ok) return { ok: false, error: body.error || 'Invalid DM credentials.' };
    write({ role: 'dm', dm: { username, password } });
    return { ok: true };
  }

  // Headers for DM-protected writes. Pages can use Auth.dmHeaders() everywhere.
  function dmHeaders() {
    const h = { 'Content-Type': 'application/json' };
    const s = read();
    if (s.role === 'dm' && s.dm) {
      h['X-DM-User'] = s.dm.username;
      h['X-DM-Pass'] = s.dm.password;
    }
    return h;
  }

  // ── Player auth ───────────────────────────────────────────────
  async function characterList() {
    try {
      const r = await fetch(WORKER_URL + '?type=character_list', { cache: 'no-store' });
      if (!r.ok) return [];
      const list = await r.json();
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  }

  async function playerLogin(characterId, code) {
    code = (code || '').toString().trim().toUpperCase();
    const r = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'character_login', characterId, code })
    });
    let body = {}; try { body = await r.json(); } catch {}
    if (!r.ok || !body.ok) return { ok: false, error: body.error || 'Invalid character or code.' };
    write({ role: 'player', player: { characterId, code, name: body.character.name } });
    return { ok: true, character: body.character };
  }

  function playerCreds() {
    const s = read();
    if (s.role === 'player' && s.player) return { characterId: s.player.characterId, code: s.player.code, name: s.player.name };
    return null;
  }

  // ── Common ────────────────────────────────────────────────────
  function logout() { clear(); }

  // Redirect to home if the role doesn't satisfy `required`.
  //   required: 'dm' | 'player' | 'any-login' | 'anonymous-or-better'
  function requireRole(required, opts = {}) {
    const role = getRole();
    const ok =
      required === 'dm'                 ? role === 'dm'
    : required === 'player'             ? role === 'player'
    : required === 'any-login'          ? role !== 'anonymous'
    : required === 'anonymous-or-better'? true
    : true;
    if (ok) return true;
    const reason = opts.reason || ({
      'dm':        'This tool is for the DM only.',
      'player':    'Log in as a player to use this tool.',
      'any-login': 'Log in to access this tool.',
    }[required] || 'You don\'t have access to this tool.');
    const dest = opts.home || 'home.html';
    const url = `${dest}?notice=${encodeURIComponent(reason)}`;
    // Defer so the page can render its skeleton briefly if it wants
    if (opts.immediate === false) {
      setTimeout(() => { window.location.replace(url); }, 0);
    } else {
      window.location.replace(url);
    }
    return false;
  }

  window.Auth = {
    getRole, identity, logout,
    dmStatus, dmSetup, dmLogin, dmHeaders,
    characterList, playerLogin, playerCreds,
    requireRole,
    WORKER_URL,
  };
})();
