// ═══════════════════════════════════════════════════════════════
//  DnD Companion Worker
//  Handles:
//    1. Discord webhook forwarding
//    2. Initiative state storage  (GET/POST) — KV
//    3. Map data storage          (GET/POST) — KV
//    4. Characters + claim codes  (GET/POST) — KV
//    5. Per-character journals    (GET/POST) — KV
//    6. Player login + filtered player_view
//
//  Requires a KV namespace bound as DND_STORE.
//  Setup:
//    Cloudflare dashboard → Workers & Pages → KV
//      → Create namespace "DND_STORE"
//    Your Worker → Settings → Variables:
//      → Add KV binding:  DND_STORE  →  the namespace above
//      → Add secret:      DM_TOKEN   →  a long random string only you know
//        (used to gate every DM-write endpoint; if unset, writes are
//         allowed without a token — the legacy behavior — but a
//         warning header is returned so you notice.)
// ═══════════════════════════════════════════════════════════════

const DISCORD_WEBHOOK_URL = '';  // ← optional Discord webhook URL

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-DM-Token',
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
function isDMAuthed(request, env) {
  // If DM_TOKEN isn't configured, allow (legacy mode). Otherwise require match.
  if (!env.DM_TOKEN) return { ok: true, legacy: true };
  const headerToken = request.headers.get('X-DM-Token') || '';
  if (headerToken && headerToken === env.DM_TOKEN) return { ok: true };
  return { ok: false };
}
function sanitizeCharacters(chars) {
  return (chars || []).map(c => ({ id: c.id, name: c.name, player: c.player || '' }));
}
function filterForCharacter(mapData, characterId) {
  if (!mapData || typeof mapData !== 'object') return mapData;
  const out = { ...mapData };
  const visibleTo = entry => {
    if (!entry || !Array.isArray(entry.visibleTo) || entry.visibleTo.length === 0) return true;
    return entry.visibleTo.includes(characterId);
  };
  out.locations = (mapData.locations || []).filter(visibleTo).map(loc => {
    // also filter NPCs and quests on this location
    const npcs   = (loc.npcs   || []).filter(visibleTo);
    const quests = (loc.quests || []).filter(visibleTo);
    return { ...loc, npcs, quests };
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

      // Existing: full DM-or-public data dumps
      if (type === 'initiative_state' || type === 'map_data' || type === 'map_data_dm') {
        const value = await kvGet(env, type, {});
        return json(value);
      }

      // Public sanitized list of characters (no codes) — used by player login dropdown
      if (type === 'character_list') {
        const chars = await kvGet(env, 'characters', []);
        return json(sanitizeCharacters(chars));
      }

      // Full characters list — DM only (includes codes)
      if (type === 'characters') {
        const auth = isDMAuthed(request, env);
        if (!auth.ok) return json({ error: 'DM token required' }, 401);
        const chars = await kvGet(env, 'characters', []);
        return json(chars);
      }

      // All journals — DM only
      if (type === 'journals') {
        const auth = isDMAuthed(request, env);
        if (!auth.ok) return json({ error: 'DM token required' }, 401);
        const journals = await kvGet(env, 'journals', []);
        return json(journals);
      }

      // Player view — filtered map data + this character's journal entries.
      // Auth: characterId + code must match the stored character.
      if (type === 'player_view') {
        const characterId = url.searchParams.get('characterId') || '';
        const code        = url.searchParams.get('code') || '';
        if (!characterId || !code) return json({ error: 'characterId and code required' }, 400);

        const chars = await kvGet(env, 'characters', []);
        const me = chars.find(c => c.id === characterId);
        if (!me || me.code !== code) return json({ error: 'invalid character or code' }, 401);

        // Use the published player-safe map if it exists; else fall back to the DM map (without dmNotes).
        const playerMap = await kvGet(env, 'map_data', null);
        const dmMap     = await kvGet(env, 'map_data_dm', null);
        const baseMap   = playerMap || dmMap || {};
        const filteredMap = filterForCharacter(baseMap, characterId);

        const allJournals = await kvGet(env, 'journals', []);
        const myJournals  = allJournals.filter(j => j.characterId === characterId);

        return json({
          character: { id: me.id, name: me.name, player: me.player || '' },
          map: filteredMap,
          journals: myJournals
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

    // ── Player login challenge (no DM token needed) ────────────
    if (body?.type === 'character_login') {
      const characterId = (body.characterId || '').toString();
      const code        = (body.code || '').toString();
      if (!characterId || !code) return json({ ok: false, error: 'characterId and code required' }, 400);
      const chars = await kvGet(env, 'characters', []);
      const me = chars.find(c => c.id === characterId);
      if (!me || me.code !== code) return json({ ok: false, error: 'invalid character or code' }, 401);
      return json({ ok: true, character: { id: me.id, name: me.name, player: me.player || '' } });
    }

    // ── DM-only writes (gated by DM_TOKEN) ─────────────────────
    const DM_WRITE_TYPES = ['initiative_state','map_data','map_data_dm','characters','journals'];
    if (DM_WRITE_TYPES.includes(body?.type)) {
      const auth = isDMAuthed(request, env);
      if (!auth.ok) return json({ error: 'DM token required' }, 401);
      const ok = await kvPut(env, body.type, body.payload);
      if (!ok) return json({ error: 'KV not bound' }, 500);
      return json({ ok: true, ...(auth.legacy ? { warning: 'DM_TOKEN not set on worker — writes are unprotected. Set DM_TOKEN in Worker Settings → Variables.' } : {}) });
    }

    // ── Forward to Discord webhook ─────────────────────────────
    if (!DISCORD_WEBHOOK_URL) return text('Webhook not configured', 500);
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return text(res.ok ? 'ok' : 'error', res.ok ? 200 : 500);
  }
};
