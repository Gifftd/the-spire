// ═══════════════════════════════════════════════════════════════
//  DnD Companion Worker
//  Handles:
//    1. Discord webhook forwarding
//    2. Initiative state (GET/POST) — KV
//    3. Map data (GET/POST)         — KV  (player-safe + DM-only)
//    4. Characters + claim codes    — KV
//    5. Per-character journals      — KV
//    6. DM account (username/pw)    — KV  (hashed)
//    7. Player login + filtered player_view
//
//  Required worker variables:
//    KV binding:  DND_STORE
//    Secret:      DM_TOKEN   (master key — bootstraps DM account,
//                             still accepted on write endpoints if you
//                             prefer to skip the username/password flow)
//
//  Setup the DM account once on the homepage. First-time signup requires
//  DM_TOKEN; after that you log in with the username + password you chose.
// ═══════════════════════════════════════════════════════════════

const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1504520226270609550/-RUnyG2HYV2N0gTDMPjzZgnd3y18vivVhSwyzwnV3wU6Aqv0ZFOMcfkoHh6vgP2UbEgw';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-DM-Token, X-DM-User, X-DM-Pass',
};

// ── Helpers ────────────────────────────────────────────────────
function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, ...extra, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
function text(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: { ...CORS, ...extra } });
}
async function kvGet(env, key, fallback) {
  if (!env.DND_STORE) return fallback;
  const raw = await env.DND_STORE.get(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
async function kvPut(env, key, obj) {
  if (!env.DND_STORE) return false;
  await env.DND_STORE.put(key, JSON.stringify(obj));
  return true;
}

// Hash a password with a per-account salt using SHA-256.
async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const data = enc.encode(`${salt}:${password}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
}
function randomSalt(len = 16) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
}
function constantTimeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ── DM authentication ─────────────────────────────────────────
// Either:
//   - X-DM-Token matches env.DM_TOKEN (master key, env-only)
//   - X-DM-User + X-DM-Pass match the stored dm_account (preferred everyday auth)
// Legacy fallback: if neither DM_TOKEN nor a dm_account is configured at all,
// writes are allowed (with a warning). This avoids locking you out on first
// run before either is set up.
async function verifyDMAuth(request, env) {
  const headerToken = request.headers.get('X-DM-Token') || '';
  if (env.DM_TOKEN && headerToken && constantTimeEq(headerToken, env.DM_TOKEN)) {
    return { ok: true, via: 'token' };
  }
  const u = request.headers.get('X-DM-User') || '';
  const p = request.headers.get('X-DM-Pass') || '';
  if (u && p) {
    const acct = await kvGet(env, 'dm_account', null);
    if (acct && acct.username === u) {
      const hash = await hashPassword(p, acct.salt);
      if (constantTimeEq(hash, acct.hash)) return { ok: true, via: 'password' };
    }
  }
  // Legacy: nothing configured at all — let it pass with a warning
  const hasToken = !!env.DM_TOKEN;
  const acct = await kvGet(env, 'dm_account', null);
  if (!hasToken && !acct) return { ok: true, via: 'legacy', warning: 'Worker has no DM_TOKEN and no dm_account — writes are unprotected.' };
  return { ok: false };
}

function sanitizeCharacters(chars) {
  return (chars || []).map(c => ({ id: c.id, name: c.name, player: c.player || '' }));
}

// Return timeline entries visible to a given audience.
//   characterId === null  → anonymous (public, ungated, non-planned only)
//   characterId === 'id'  → that character (public + entries with them in visibleTo, non-planned)
// Always strips dmNotes from the result.
function timelineForCharacter(entries, characterId) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(e => e && e.kind !== 'planned')
    .filter(e => {
      if (!Array.isArray(e.visibleTo) || e.visibleTo.length === 0) return true;
      if (!characterId) return false;
      return e.visibleTo.includes(characterId);
    })
    .map(e => {
      const { dmNotes, ...rest } = e;
      return rest;
    });
}

// Return the NPCs a given character knows about, with DM-only fields stripped.
// characterId === null means anonymous — never returns NPCs (visibility is opt-in only).
function npcsForCharacter(allNpcs, characterId) {
  if (!Array.isArray(allNpcs) || !characterId) return [];
  return allNpcs
    .filter(n => Array.isArray(n.knownTo) && n.knownTo.includes(characterId))
    .map(n => ({
      id: n.id,
      name: n.name,
      role: n.role || '',
      description: n.description || '',
      portrait: n.portrait || '',
      currentLocationId: n.currentLocationId || null,
      currentActivity: n.currentActivity || '',
      status: n.status || 'alive',
      notes: n.notes || '',
      tags: Array.isArray(n.tags) ? n.tags : [],
      // History stripped of any "dmOnly" entries
      history: (n.history || []).filter(h => !h.dmOnly).map(h => ({
        id: h.id, locationId: h.locationId || null,
        activity: h.activity || '', date: h.date || '',
        note: h.note || ''
      }))
      // dmNotes deliberately omitted
    }));
}

function filterForCharacter(mapData, characterId) {
  if (!mapData || typeof mapData !== 'object') return mapData;
  const out = { ...mapData };
  const visibleTo = entry => {
    if (!entry || !Array.isArray(entry.visibleTo) || entry.visibleTo.length === 0) return true;
    return entry.visibleTo.includes(characterId);
  };
  // Strip DM-only fields from a sub-map pin / zone before serving to a player.
  // dmNotes never leaves the worker for player_view.
  const sanitizeSubPin = p => { const { dmNotes, ...rest } = p; return rest; };

  out.locations = (mapData.locations || []).filter(visibleTo).map(loc => {
    const npcs   = (loc.npcs   || []).filter(visibleTo);
    const quests = (loc.quests || []).filter(visibleTo);
    let subMap = loc.subMap || null;
    if (subMap && typeof subMap === 'object') {
      const pins  = Array.isArray(subMap.locations) ? subMap.locations.filter(visibleTo).map(sanitizeSubPin)
                  : Array.isArray(subMap.pins)      ? subMap.pins.filter(visibleTo).map(sanitizeSubPin)
                  : [];
      const zones = Array.isArray(subMap.zones)     ? subMap.zones.filter(visibleTo) : [];
      subMap = { ...subMap, locations: pins, zones };
    }
    // dmNotes never leaves the worker for any non-DM caller.
    const { dmNotes, ...locRest } = loc;
    return { ...locRest, npcs, quests, subMap };
  });
  out.zones = (mapData.zones || []).filter(visibleTo);
  return out;
}

// ═══════════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url  = new URL(request.url);
    const type = url.searchParams.get('type');

    // ─────────────────────────────────────────────────────────────
    //  GET
    // ─────────────────────────────────────────────────────────────
    if (request.method === 'GET') {

      // DM-only raw map dump — gated
      if (type === 'map_data_dm') {
        const auth = await verifyDMAuth(request, env);
        if (!auth.ok) return json({ error: 'DM auth required' }, 401);
        const value = await kvGet(env, type, {});
        return json(value);
      }

      // Initiative state — readable by everyone (players need it to see turn order)
      if (type === 'initiative_state') {
        const value = await kvGet(env, type, {});
        return json(value);
      }

      // Anonymous map view — server-side filter strips visibleTo-gated items
      if (type === 'map_data') {
        const value = await kvGet(env, type, {});
        const anonymized = filterForCharacter(value, null);
        return json(anonymized);
      }

      // Public sanitized character list (login dropdown)
      if (type === 'character_list') {
        const chars = await kvGet(env, 'characters', []);
        return json(sanitizeCharacters(chars));
      }

      // DM-only: full character list (with codes)
      if (type === 'characters') {
        const auth = await verifyDMAuth(request, env);
        if (!auth.ok) return json({ error: 'DM auth required' }, 401);
        return json(await kvGet(env, 'characters', []));
      }

      // DM-only: all journals
      if (type === 'journals') {
        const auth = await verifyDMAuth(request, env);
        if (!auth.ok) return json({ error: 'DM auth required' }, 401);
        return json(await kvGet(env, 'journals', []));
      }

      // DM-only: all NPCs (full data including dmNotes + everyone's knownTo)
      if (type === 'npcs') {
        const auth = await verifyDMAuth(request, env);
        if (!auth.ok) return json({ error: 'DM auth required' }, 401);
        return json(await kvGet(env, 'npcs', []));
      }

      // Anonymous-safe campaign timeline (public, non-planned, dmNotes stripped).
      if (type === 'timeline') {
        const entries = await kvGet(env, 'timeline', []);
        return json(timelineForCharacter(entries, null));
      }

      // Per-character timeline view (public + their gated, non-planned, dmNotes stripped).
      if (type === 'timeline_view') {
        const characterId = url.searchParams.get('characterId') || '';
        const code        = url.searchParams.get('code') || '';
        if (!characterId || !code) return json({ error: 'characterId and code required' }, 400);
        const chars = await kvGet(env, 'characters', []);
        const me = chars.find(c => c.id === characterId);
        if (!me || me.code !== code) return json({ error: 'invalid character or code' }, 401);
        const entries = await kvGet(env, 'timeline', []);
        return json(timelineForCharacter(entries, characterId));
      }

      // DM-only: full timeline (includes planned entries + dmNotes).
      if (type === 'timeline_dm') {
        const auth = await verifyDMAuth(request, env);
        if (!auth.ok) return json({ error: 'DM auth required' }, 401);
        return json(await kvGet(env, 'timeline', []));
      }

      // Player NPC roster — only NPCs the character has been marked as knowing,
      // with DM-only fields stripped server-side.
      if (type === 'npc_roster') {
        const characterId = url.searchParams.get('characterId') || '';
        const code        = url.searchParams.get('code') || '';
        if (!characterId || !code) return json({ error: 'characterId and code required' }, 400);
        const chars = await kvGet(env, 'characters', []);
        const me = chars.find(c => c.id === characterId);
        if (!me || me.code !== code) return json({ error: 'invalid character or code' }, 401);
        const all = await kvGet(env, 'npcs', []);
        return json(npcsForCharacter(all, characterId));
      }

      // Whether the DM account has been configured (used by homepage to decide
      // between setup and login flows).
      if (type === 'dm_status') {
        const acct = await kvGet(env, 'dm_account', null);
        return json({ configured: !!acct, hasMasterToken: !!env.DM_TOKEN });
      }

      // Player view — server-side filtered map for a specific character + their journals
      if (type === 'player_view') {
        const characterId = url.searchParams.get('characterId') || '';
        const code        = url.searchParams.get('code') || '';
        if (!characterId || !code) return json({ error: 'characterId and code required' }, 400);

        const chars = await kvGet(env, 'characters', []);
        const me = chars.find(c => c.id === characterId);
        if (!me || me.code !== code) return json({ error: 'invalid character or code' }, 401);

        const playerMap = await kvGet(env, 'map_data', null);
        const dmMap     = await kvGet(env, 'map_data_dm', null);
        const baseMap   = playerMap || dmMap || {};
        const filteredMap = filterForCharacter(baseMap, characterId);

        const allJournals = await kvGet(env, 'journals', []);
        const myJournals  = allJournals.filter(j => j.characterId === characterId);

        const allNpcs   = await kvGet(env, 'npcs', []);
        const knownNpcs = npcsForCharacter(allNpcs, characterId);

        return json({
          character: { id: me.id, name: me.name, player: me.player || '' },
          map: filteredMap,
          journals: myJournals,
          npcs: knownNpcs
        });
      }

      return text('Not found', 404);
    }

    // ─────────────────────────────────────────────────────────────
    //  POST
    // ─────────────────────────────────────────────────────────────
    if (request.method !== 'POST') return text('Method not allowed', 405);

    let body;
    try { body = await request.json(); }
    catch { return text('Invalid JSON', 400); }

    // ── DM account setup ──────────────────────────────────────
    // Allowed in two scenarios:
    //   1. No account exists yet — anyone with knowledge of the URL can claim it,
    //      so wrap this in DM_TOKEN gate if you set DM_TOKEN. Without DM_TOKEN
    //      the first POST wins (intentional — used for fresh installs).
    //   2. An account exists and the caller provides X-DM-Token (master) or
    //      valid X-DM-User/Pass — they're resetting the password.
    if (body?.type === 'dm_setup') {
      const username = (body.username || '').toString().trim();
      const password = (body.password || '').toString();
      if (!username || username.length < 2) return json({ ok:false, error: 'Username must be at least 2 characters.' }, 400);
      if (!password || password.length < 6) return json({ ok:false, error: 'Password must be at least 6 characters.' }, 400);

      const existing = await kvGet(env, 'dm_account', null);
      if (existing) {
        const auth = await verifyDMAuth(request, env);
        if (!auth.ok || auth.via === 'legacy') return json({ ok:false, error: 'DM account already configured. Provide the current DM token or password to reset it.' }, 401);
      } else if (env.DM_TOKEN) {
        // Account doesn't exist but DM_TOKEN is set — require it to bootstrap
        const t = request.headers.get('X-DM-Token') || '';
        if (!t || !constantTimeEq(t, env.DM_TOKEN)) {
          return json({ ok:false, error: 'DM_TOKEN required for first-time setup.' }, 401);
        }
      }
      const salt = randomSalt();
      const hash = await hashPassword(password, salt);
      await kvPut(env, 'dm_account', { username, salt, hash, createdAt: new Date().toISOString() });
      return json({ ok: true });
    }

    // ── DM login (validate only) ──────────────────────────────
    if (body?.type === 'dm_login') {
      const u = (body.username || '').toString();
      const p = (body.password || '').toString();
      const acct = await kvGet(env, 'dm_account', null);
      if (!acct) return json({ ok:false, error: 'DM account not set up yet.' }, 400);
      if (acct.username !== u) return json({ ok:false, error: 'Invalid credentials.' }, 401);
      const hash = await hashPassword(p, acct.salt);
      if (!constantTimeEq(hash, acct.hash)) return json({ ok:false, error: 'Invalid credentials.' }, 401);
      return json({ ok: true, username: acct.username });
    }

    // ── Player login challenge (no DM auth needed) ────────────
    if (body?.type === 'character_login') {
      const characterId = (body.characterId || '').toString();
      const code        = (body.code || '').toString();
      if (!characterId || !code) return json({ ok: false, error: 'characterId and code required' }, 400);
      const chars = await kvGet(env, 'characters', []);
      const me = chars.find(c => c.id === characterId);
      if (!me || me.code !== code) return json({ ok: false, error: 'invalid character or code' }, 401);
      return json({ ok: true, character: { id: me.id, name: me.name, player: me.player || '' } });
    }

    // ── DM-only writes ────────────────────────────────────────
    const DM_WRITE_TYPES = ['initiative_state','map_data','map_data_dm','characters','journals','npcs','timeline'];
    if (DM_WRITE_TYPES.includes(body?.type)) {
      const auth = await verifyDMAuth(request, env);
      if (!auth.ok) return json({ error: 'DM auth required' }, 401);
      const ok = await kvPut(env, body.type, body.payload);
      if (!ok) return json({ error: 'KV not bound' }, 500);
      return json({ ok: true, ...(auth.warning ? { warning: auth.warning } : {}) });
    }

    // ── Forward to Discord webhook ────────────────────────────
    if (!DISCORD_WEBHOOK_URL) return text('Webhook not configured', 500);
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return text(res.ok ? 'ok' : 'error', res.ok ? 200 : 500);
  }
};
