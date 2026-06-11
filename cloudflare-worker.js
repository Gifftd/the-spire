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

// ─── Player auth ───────────────────────────────────────────────────
// Mirrors the inline validation used in character_login + brew handlers.
// Returns { ok: true, character } or { ok: false, error: '<reason>' }.
// Uses the SAME shape as DM auth so handlers can branch uniformly.
async function verifyCharacterAuth(body, env) {
  const characterId = (body && body.characterId || '').toString();
  const code        = (body && body.code        || '').toString();
  if (!characterId || !code) return { ok: false, error: 'characterId and code required' };
  const chars = await kvGet(env, 'characters', []);
  const me = chars.find(c => c.id === characterId);
  if (!me || me.code !== code) return { ok: false, error: 'invalid character or code' };
  return { ok: true, character: me };
}

// ═══════════════════════════════════════════════════════════════════════
// BEGIN initiative-notes.js (inlined — keep in sync with /initiative-notes.js)
// Any change to MAX_NOTE_LENGTH, MAX_NOTES_PER_CHARACTER, filterInitiativeState,
// mergeDMWritePreservingNotes, validateNote, or canDeleteNote MUST be mirrored
// in both files. Tests at /tests/initiative-notes.test.html cover the source.
// ═══════════════════════════════════════════════════════════════════════
const INITIATIVE_NOTES = (function () {
  const MAX_NOTE_LENGTH = 500;
  const MAX_NOTES_PER_CHARACTER = 50;
  const VISIBILITIES = ['private', 'party'];

  function filterInitiativeState(state, viewer) {
    if (!state || typeof state !== 'object') return { combatants: [] };
    const isDM = !!(viewer && viewer.role === 'dm');
    const myId = (viewer && viewer.role === 'player' && viewer.characterId) || null;
    const combatants = Array.isArray(state.combatants) ? state.combatants : [];
    const filtered = [];
    for (const c of combatants) {
      if (!c) continue;
      if (!isDM && c.hidden) continue;
      const clone = Object.assign({}, c);
      if (!isDM) delete clone.notes;
      const allNotes = Array.isArray(c.playerNotes) ? c.playerNotes : [];
      if (isDM) {
        clone.playerNotes = allNotes.slice();
      } else {
        clone.playerNotes = allNotes.filter(n => {
          if (!n) return false;
          if (n.visibility === 'party') return true;
          if (myId && n.authorCharId === myId) return true;
          return false;
        });
      }
      filtered.push(clone);
    }
    const out = Object.assign({}, state);
    out.combatants = filtered;
    return out;
  }

  function mergeDMWritePreservingNotes(prev, incoming) {
    const prevCombatants = (prev && Array.isArray(prev.combatants)) ? prev.combatants : [];
    const prevNotesById = new Map();
    for (const c of prevCombatants) {
      if (c && c.id) prevNotesById.set(c.id, Array.isArray(c.playerNotes) ? c.playerNotes.slice() : []);
    }
    const incCombatants = (incoming && Array.isArray(incoming.combatants)) ? incoming.combatants : [];
    const mergedCombatants = incCombatants.map(c => {
      if (!c) return c;
      const clone = Object.assign({}, c);
      clone.playerNotes = prevNotesById.has(c.id) ? prevNotesById.get(c.id) : [];
      return clone;
    });
    const out = Object.assign({}, incoming || {});
    out.combatants = mergedCombatants;
    return out;
  }

  function validateNote(input) {
    if (!input || typeof input !== 'object') {
      return { ok: false, error: 'note must be an object' };
    }
    const body = typeof input.body === 'string' ? input.body : '';
    const trimmed = body.trim();
    if (!trimmed) return { ok: false, error: 'body is required' };
    if (body.length > MAX_NOTE_LENGTH) {
      return { ok: false, error: 'body too long (max ' + MAX_NOTE_LENGTH + ' chars)' };
    }
    if (!VISIBILITIES.includes(input.visibility)) {
      return { ok: false, error: 'visibility must be private or party' };
    }
    return { ok: true };
  }

  function canDeleteNote(note, viewer) {
    if (!note || !viewer) return false;
    if (viewer.role === 'dm') return true;
    if (viewer.role === 'player' && viewer.characterId
        && note.authorCharId === viewer.characterId) return true;
    return false;
  }

  return {
    MAX_NOTE_LENGTH, MAX_NOTES_PER_CHARACTER, VISIBILITIES,
    filterInitiativeState, mergeDMWritePreservingNotes, validateNote, canDeleteNote,
  };
})();
// END initiative-notes.js (inlined)

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
      // Combats carry a DM-only `dmDetail` (full HP tables + combat notes).
      // Strip it; keep the player-safe summary fields and the loot table.
      if (Array.isArray(rest.combats)) {
        rest.combats = rest.combats.map(c => { const { dmDetail, ...cr } = c; return cr; });
      }
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

// ── Potion brewing resolution ──────────────────────────────────
// Obojima (homebrew) brewing. 3 unique ingredients → sum each attribute;
// the highest total picks the list (combat|utility|whimsy) and IS the potion
// number (1-60). Rarity comes from the number band; DC from rarity. Outcome
// depends on the margin (rollTotal - DC):
//   +10 or more  → 'choose'   (player may pick any potion at the slot)
//   0..+9        → 'success'  (the intended/official potion)
//   -1..-5       → 'wrong'    (a random potion from the slot)
//   -6..-9       → 'sludge'   (nothing brewed; ingredients still consumed)
//   -10 or worse → 'negative' (a random negative potion)
// Potions never leave the worker except as the resolved result (snoop-safe).
function brewBand(number) {
  return number <= 30 ? 'common' : number <= 50 ? 'uncommon' : 'rare';
}
function brewResolve(ingredients, potions, negatives, ids, rollTotal, chosenCategory, intendedPotionId) {
  if (!Array.isArray(ids) || ids.length !== 3) return { error: 'Select exactly three ingredients.' };
  if (new Set(ids).size !== 3) return { error: 'The three ingredients must be unique.' };
  const byId = Object.fromEntries((ingredients || []).map(i => [i.id, i]));
  const chosen = ids.map(id => byId[id]);
  if (chosen.some(i => !i)) return { error: 'One or more ingredients are unknown.' };

  const sums = {
    combat:  chosen.reduce((s, i) => s + (+i.combat  || 0), 0),
    utility: chosen.reduce((s, i) => s + (+i.utility || 0), 0),
    whimsy:  chosen.reduce((s, i) => s + (+i.whimsy  || 0), 0),
  };
  const peak = Math.max(sums.combat, sums.utility, sums.whimsy);
  const winners = ['combat', 'utility', 'whimsy'].filter(c => sums[c] === peak);
  let category = winners[0];
  if (winners.length > 1 && winners.includes(chosenCategory)) category = chosenCategory;

  const number = sums[category];
  const rarity = brewBand(number);
  const DC  = rarity === 'common' ? 10 : rarity === 'uncommon' ? 15 : 20;
  const muk = rarity === 'common' ? 15 : rarity === 'uncommon' ? 75 : 300;
  const margin = (rollTotal | 0) - DC;
  const slot = { category, number, rarity, DC, muk, sums, winners, tie: winners.length > 1, margin, rollTotal: rollTotal | 0 };

  const slotPotions = (potions || []).filter(p => p.category === category && p.number === number);
  const official = slotPotions.find(p => p.official) || slotPotions[0] || null;
  const pick = arr => (arr && arr.length) ? arr[Math.floor(Math.random() * arr.length)] : null;
  const normAff = s => (s || '').toString().trim().toLowerCase();

  // Tally elemental affinities present in the 3 ingredients. Used to select a
  // variant within the slot on a clean success.
  const affTally = {};
  chosen.forEach(i => { const a = normAff(i.affinity); if (a) affTally[a] = (affTally[a] || 0) + 1; });
  const active = Object.keys(affTally);
  slot.affinity = { tally: affTally, active };

  let outcome, potion = null, options = null, chooseReason = null;
  if (margin >= 10) {
    outcome = 'choose'; options = slotPotions; chooseReason = 'mastery';
  } else if (margin >= 0) {
    outcome = 'success';
    if (active.length === 0) {
      // No affinity in ingredients → random version (random among slot variants).
      potion = pick(slotPotions) || official;
    } else if (active.length === 1) {
      // One affinity in ingredients → the slot variant with that affinity, else official.
      const aff = active[0];
      const matching = slotPotions.filter(p => normAff(p.affinity) === aff);
      if (matching.length === 0) {
        potion = (intendedPotionId && slotPotions.find(p => p.id === intendedPotionId)) || official;
      } else {
        potion = matching.find(p => p.official) || matching[0];
      }
    } else {
      // 2+ different affinities → player picks among the matching variants.
      const matchingAny = slotPotions.filter(p => { const a = normAff(p.affinity); return a && active.indexOf(a) >= 0; });
      if (matchingAny.length === 0) {
        potion = (intendedPotionId && slotPotions.find(p => p.id === intendedPotionId)) || official;
      } else if (matchingAny.length === 1) {
        potion = matchingAny[0];
      } else {
        outcome = 'choose'; options = matchingAny; chooseReason = 'affinity'; potion = null;
      }
    }
  } else if (margin >= -5) {
    outcome = 'wrong'; potion = pick(slotPotions);
  } else if (margin >= -9) {
    outcome = 'sludge';
  } else {
    outcome = 'negative'; potion = pick(negatives);
  }

  // A slot with no authored potion can't yield one — degrade to sludge.
  if ((outcome === 'success' || outcome === 'wrong') && !potion) { outcome = 'sludge'; }
  if (outcome === 'choose' && (!options || options.length === 0)) { outcome = 'sludge'; options = null; chooseReason = null; }

  return { slot, outcome, potion, options, chooseReason };
}

// ── Per-character recipe book ──────────────────────────────────
// A recipe is a 3-ingredient combo + the potion it produced, stored per
// character under the `potion_recipes` KV key: { [characterId]: [recipe...] }.
// Deduped by (sorted ingredient ids + potion id), so a combo that can make
// more than one potion (via a masterful "choose") yields one entry per potion.
function recipeKey(ids, potionId) { return (ids || []).slice().sort().join('|') + '::' + potionId; }
function addRecipe(recipesMap, characterId, ingredientIds, potion, source) {
  if (!potion || !potion.id) return false;
  if (!Array.isArray(recipesMap[characterId])) recipesMap[characterId] = [];
  const key = recipeKey(ingredientIds, potion.id);
  if (recipesMap[characterId].some(r => recipeKey(r.ingredientIds, r.potionId) === key)) return false;
  recipesMap[characterId].push({
    id: 'rcp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ingredientIds: ingredientIds.slice(),
    category: potion.category, number: potion.number,
    potionId: potion.id, potionName: potion.name,
    source: source || 'brew', at: new Date().toISOString()
  });
  return true;
}
// Sum a combo's attributes (for validating a recipe combo → potion).
function attrSums(ingredients, ids) {
  const byId = Object.fromEntries((ingredients || []).map(i => [i.id, i]));
  const chosen = (ids || []).map(id => byId[id]);
  if (chosen.some(i => !i)) return null;
  return {
    combat:  chosen.reduce((s, i) => s + (+i.combat  || 0), 0),
    utility: chosen.reduce((s, i) => s + (+i.utility || 0), 0),
    whimsy:  chosen.reduce((s, i) => s + (+i.whimsy  || 0), 0),
  };
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

      // Initiative state — filtered per viewer (see initiative-notes.js).
      //   DM creds (X-DM-* headers)            → full unfiltered state
      //   Player creds (?characterId=…&code=…) → hidden combatants dropped,
      //                                          DM `notes` string stripped,
      //                                          playerNotes = own private + party
      //   No creds                             → same as player, but party-only notes
      if (type === 'initiative_state') {
        const value = await kvGet(env, type, {});
        // Try DM first
        const dmAuth = await verifyDMAuth(request, env);
        if (dmAuth.ok) {
          return json(INITIATIVE_NOTES.filterInitiativeState(value, { role: 'dm' }));
        }
        // Try player query creds (?characterId=…&code=…)
        const qCharacterId = url.searchParams.get('characterId') || '';
        const qCode        = url.searchParams.get('code') || '';
        if (qCharacterId || qCode) {
          if (!qCharacterId || !qCode) return json({ error: 'characterId and code required' }, 400);
          const chars = await kvGet(env, 'characters', []);
          const me = chars.find(c => c.id === qCharacterId);
          if (!me || me.code !== qCode) return json({ error: 'invalid character or code' }, 401);
          return json(INITIATIVE_NOTES.filterInitiativeState(value, {
            role: 'player', characterId: me.id
          }));
        }
        // Anonymous
        return json(INITIATIVE_NOTES.filterInitiativeState(value, null));
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

      // DM-only: combat drafts (auto-saved in-progress and pending-export combats).
      // Always DM-only — never returned to players. Drafts contain dmDetail HP logs.
      if (type === 'combat_drafts') {
        const auth = await verifyDMAuth(request, env);
        if (!auth.ok) return json({ error: 'DM auth required' }, 401);
        return json(await kvGet(env, 'combat_drafts', []));
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

      // Player brewing data — full ingredient catalogue + this character's
      // ingredient inventory. Potions/negatives are deliberately NOT included
      // (they only ever surface as a resolved brew result).
      if (type === 'brew_player') {
        const characterId = url.searchParams.get('characterId') || '';
        const code        = url.searchParams.get('code') || '';
        if (!characterId || !code) return json({ error: 'characterId and code required' }, 400);
        const chars = await kvGet(env, 'characters', []);
        const me = chars.find(c => c.id === characterId);
        if (!me || me.code !== code) return json({ error: 'invalid character or code' }, 401);
        const ingredients = await kvGet(env, 'potion_ingredients', []);
        const invAll = await kvGet(env, 'potion_inventories', {}) || {};
        const recAll = await kvGet(env, 'potion_recipes', {}) || {};
        return json({
          character: { id: me.id, name: me.name, player: me.player || '' },
          ingredients,
          inventory: Array.isArray(invAll[characterId]) ? invAll[characterId] : [],
          recipes: Array.isArray(recAll[characterId]) ? recAll[characterId] : []
        });
      }

      // DM-only: full bestiary (monsters scraped + normalized from source books).
      // Copyrighted content — never served to players. The list-shape ({monsters,...})
      // is whatever the DM imported; consumers should tolerate either an envelope
      // or a bare array.
      if (type === 'bestiary') {
        const auth = await verifyDMAuth(request, env);
        if (!auth.ok) return json({ error: 'DM auth required' }, 401);
        return json(await kvGet(env, 'bestiary', { monsters: [] }));
      }

      // DM-only: custom (homebrew) monsters authored in the Menagerie editor.
      // Stored separately from the imported `bestiary` so a re-import of source
      // book content never touches the DM's homebrew. Always returns a bare
      // array — the editor concatenates it onto the imported bestiary.
      if (type === 'bestiary_custom') {
        const auth = await verifyDMAuth(request, env);
        if (!auth.ok) return json({ error: 'DM auth required' }, 401);
        return json(await kvGet(env, 'bestiary_custom', []));
      }

      // DM-only: saved encounter presets — bundles of bestiary picks (name,
      // qty, per-pick options) the DM can reload into the War Table picker.
      // Bare array. Entries carry denormalized totals so the picker list view
      // doesn't have to re-look-up the bestiary just to render the catalogue.
      if (type === 'encounters') {
        const auth = await verifyDMAuth(request, env);
        if (!auth.ok) return json({ error: 'DM auth required' }, 401);
        const arr = await kvGet(env, 'encounters', []);
        // Stamp schemaVersion: 1 on records missing it so the front-end can branch cleanly.
        const stamped = Array.isArray(arr) ? arr.map(r =>
          (r && typeof r === 'object' && r.schemaVersion == null)
            ? { ...r, schemaVersion: 1 }
            : r
        ) : [];
        return json(stamped);
      }

      // DM-only: normalized feature library used by the Menagerie's
      // monster generator. Produced by `scripts/extract_features.py` —
      // a flat, tier-stratified, donor-agnostic catalog of every
      // trait/action/bonus/reaction/legendary action extracted from the
      // imported bestiary. Schema is `{schemaVersion, features: [...]}`.
      if (type === 'feature_library') {
        const auth = await verifyDMAuth(request, env);
        if (!auth.ok) return json({ error: 'DM auth required' }, 401);
        return json(await kvGet(env, 'feature_library', { schemaVersion: 0, features: [] }));
      }

      // DM-only: everything the apothecary editor needs in one shot.
      if (type === 'potion_data_dm') {
        const auth = await verifyDMAuth(request, env);
        if (!auth.ok) return json({ error: 'DM auth required' }, 401);
        return json({
          ingredients: await kvGet(env, 'potion_ingredients', []),
          potions:     await kvGet(env, 'potions', []),
          negatives:   await kvGet(env, 'negative_potions', []),
          inventories: await kvGet(env, 'potion_inventories', {}) || {},
          recipes:     await kvGet(env, 'potion_recipes', {}) || {},
          library:     await kvGet(env, 'potion_library', []),
          characters:  sanitizeCharacters(await kvGet(env, 'characters', []))
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

    // ── Add a note on a combatant (player-only authoring) ──────────
    // Auth: body.characterId + body.code.
    // Worker re-resolves authorName from the looked-up character to prevent
    // spoofing. Per-character cap of MAX_NOTES_PER_CHARACTER per encounter.
    // Body length capped at MAX_NOTE_LENGTH chars.
    if (body?.type === 'initiative_note') {
      const auth = await verifyCharacterAuth(body, env);
      if (!auth.ok) return json({ error: auth.error }, 401);

      const combatantId = (body.combatantId || '').toString();
      if (!combatantId) return json({ error: 'combatantId required' }, 400);

      const v = INITIATIVE_NOTES.validateNote({ body: body.body, visibility: body.visibility });
      if (!v.ok) return json({ error: v.error }, 400);

      const state = await kvGet(env, 'initiative_state', { combatants: [] });
      const combatants = Array.isArray(state.combatants) ? state.combatants : [];
      // Combatant ids are numbers in KV (DM tracker uid is ++_id) but the
      // incoming combatantId is coerced to a string above. Stringify the
      // KV-side id for the comparison so 4 ("4") matches.
      const idx = combatants.findIndex(c => c && String(c.id) === combatantId);
      if (idx < 0) return json({ error: 'combatant not found' }, 404);

      const target = combatants[idx];
      const existing = Array.isArray(target.playerNotes) ? target.playerNotes : [];
      const authoredByMe = existing.filter(n => n && n.authorCharId === auth.character.id).length;
      if (authoredByMe >= INITIATIVE_NOTES.MAX_NOTES_PER_CHARACTER) {
        return json({ error: 'note limit reached for this encounter' }, 400);
      }

      const note = {
        id: 'n_' + Math.random().toString(36).slice(2, 10),
        combatantId,
        authorCharId: auth.character.id,
        authorName: auth.character.name || '',
        body: body.body.toString(),
        visibility: body.visibility,
        createdAt: Date.now(),
      };
      target.playerNotes = existing.concat([note]);
      combatants[idx] = target;
      state.combatants = combatants;
      await kvPut(env, 'initiative_state', state);
      return json({ ok: true, note });
    }

    // ── Delete a note on a combatant ────────────────────────────────
    // Auth: player creds (body.characterId + body.code) OR DM headers.
    // Only the note's author can delete their own; DM can delete any.
    if (body?.type === 'initiative_note_delete') {
      // Determine viewer (player vs DM). Try player creds first.
      let viewer = null;
      if (body.characterId && body.code) {
        const a = await verifyCharacterAuth(body, env);
        if (!a.ok) return json({ error: a.error }, 401);
        viewer = { role: 'player', characterId: a.character.id };
      } else {
        const dm = await verifyDMAuth(request, env);
        if (!dm.ok) return json({ error: 'player or DM auth required' }, 401);
        viewer = { role: 'dm' };
      }

      const combatantId = (body.combatantId || '').toString();
      const noteId      = (body.noteId      || '').toString();
      if (!combatantId || !noteId) return json({ error: 'combatantId and noteId required' }, 400);

      const state = await kvGet(env, 'initiative_state', { combatants: [] });
      const combatants = Array.isArray(state.combatants) ? state.combatants : [];
      // Combatant ids are numbers in KV (DM tracker uid is ++_id) but the
      // incoming combatantId is coerced to a string above. Stringify the
      // KV-side id for the comparison so 4 ("4") matches.
      const idx = combatants.findIndex(c => c && String(c.id) === combatantId);
      if (idx < 0) return json({ error: 'combatant not found' }, 404);

      const existing = Array.isArray(combatants[idx].playerNotes) ? combatants[idx].playerNotes : [];
      const note = existing.find(n => n && n.id === noteId);
      if (!note) return json({ error: 'note not found' }, 404);
      if (!INITIATIVE_NOTES.canDeleteNote(note, viewer)) {
        return json({ error: 'not allowed to delete that note' }, 403);
      }

      combatants[idx].playerNotes = existing.filter(n => n && n.id !== noteId);
      state.combatants = combatants;
      await kvPut(env, 'initiative_state', state);
      return json({ ok: true });
    }

    // ── Brew a potion (player or DM) ──────────────────────────
    // Auth: player (characterId + code) OR DM headers (test-brew, no consume).
    // Resolution + ingredient consumption happen server-side so the potion
    // and negative lists never reach the browser except as the result.
    if (body?.type === 'brew') {
      const characterId = (body.characterId || '').toString();
      const code        = (body.code || '').toString();
      let isDM = false;
      if (code && characterId) {
        const chars = await kvGet(env, 'characters', []);
        const me = chars.find(c => c.id === characterId);
        if (!me || me.code !== code) return json({ error: 'invalid character or code' }, 401);
      } else {
        const auth = await verifyDMAuth(request, env);
        if (!auth.ok) return json({ error: 'player code or DM auth required' }, 401);
        isDM = true;
      }

      const ingredients = await kvGet(env, 'potion_ingredients', []);
      const potions     = await kvGet(env, 'potions', []);
      const negatives   = await kvGet(env, 'negative_potions', []);
      const ids = Array.isArray(body.ingredientIds) ? body.ingredientIds.map(String) : [];
      const res = brewResolve(ingredients, potions, negatives, ids, body.rollTotal, body.category, body.intendedPotionId);
      if (res.error) return json({ error: res.error }, 400);

      // Consume the three ingredients from the character's inventory. A failed
      // or sludge brew still consumes. DM test-brews without an inventory don't.
      let consumed = false, inventory = null;
      if (characterId) {
        const invAll = await kvGet(env, 'potion_inventories', {}) || {};
        const inv = Array.isArray(invAll[characterId]) ? invAll[characterId] : [];
        const holds = id => { const e = inv.find(x => x.ingredientId === id); return e && (e.qty || 0) > 0; };
        const haveAll = ids.every(holds);
        if (!haveAll && !isDM) return json({ error: 'You do not hold all three of those ingredients.' }, 400);
        if (haveAll) {
          ids.forEach(id => { const e = inv.find(x => x.ingredientId === id); if (e) e.qty = (e.qty || 0) - 1; });
          invAll[characterId] = inv.filter(x => (x.qty || 0) > 0);
          await kvPut(env, 'potion_inventories', invAll);
          consumed = true;
          inventory = invAll[characterId];
        }
      }

      // Learn the recipe on a clean success (the intended/official potion).
      // A masterful "choose" is recorded separately once the player picks
      // (via record_recipe). Only real characters keep a recipe book.
      let learned = false, recipes = null;
      if (characterId) {
        const recAll = await kvGet(env, 'potion_recipes', {}) || {};
        if (res.outcome === 'success' && res.potion) {
          learned = addRecipe(recAll, characterId, ids, res.potion, 'brew');
          if (learned) await kvPut(env, 'potion_recipes', recAll);
        }
        recipes = Array.isArray(recAll[characterId]) ? recAll[characterId] : [];
      }
      return json({ ok: true, ...res, consumed, inventory, learned, recipes });
    }

    // ── Record a discovered recipe (player) ───────────────────
    // Used when a masterful "choose" brew lets the player pick which potion
    // they crafted. Server re-validates that the combo can actually produce
    // the chosen potion before saving, so players can't fabricate recipes.
    if (body?.type === 'record_recipe') {
      const characterId = (body.characterId || '').toString();
      const code        = (body.code || '').toString();
      if (!characterId || !code) return json({ error: 'characterId and code required' }, 400);
      const chars = await kvGet(env, 'characters', []);
      const me = chars.find(c => c.id === characterId);
      if (!me || me.code !== code) return json({ error: 'invalid character or code' }, 401);

      const ingredients = await kvGet(env, 'potion_ingredients', []);
      const potions     = await kvGet(env, 'potions', []);
      const ids = Array.isArray(body.ingredientIds) ? body.ingredientIds.map(String) : [];
      if (ids.length !== 3 || new Set(ids).size !== 3) return json({ error: 'Need three unique ingredients.' }, 400);
      const potion = potions.find(p => p.id === body.potionId);
      if (!potion) return json({ error: 'Unknown potion.' }, 400);
      const sums = attrSums(ingredients, ids);
      if (!sums) return json({ error: 'Unknown ingredient.' }, 400);
      if (sums[potion.category] !== potion.number) return json({ error: 'That combo does not brew that potion.' }, 400);

      const recAll = await kvGet(env, 'potion_recipes', {}) || {};
      const learned = addRecipe(recAll, characterId, ids, potion, 'brew');
      if (learned) await kvPut(env, 'potion_recipes', recAll);
      return json({ ok: true, learned, recipes: Array.isArray(recAll[characterId]) ? recAll[characterId] : [] });
    }

    // ── DM-only writes ────────────────────────────────────────
    const DM_WRITE_TYPES = ['initiative_state','map_data','map_data_dm','characters','journals','npcs','timeline','potion_ingredients','potions','negative_potions','potion_inventories','potion_recipes','potion_library','bestiary','bestiary_custom','encounters','feature_library','combat_drafts'];
    if (DM_WRITE_TYPES.includes(body?.type)) {
      const auth = await verifyDMAuth(request, env);
      if (!auth.ok) return json({ error: 'DM auth required' }, 401);

      // Notes-preservation merge for initiative_state: the DM tracker never
      // authors playerNotes, so KV is authoritative for that field. Copy prev
      // notes forward by combatant.id so DM HP/condition writes don't clobber
      // player-authored notes (spec §4.5).
      let payload = body.payload;
      if (body.type === 'initiative_state') {
        const prev = await kvGet(env, 'initiative_state', { combatants: [] });
        payload = INITIATIVE_NOTES.mergeDMWritePreservingNotes(prev, body.payload || { combatants: [] });
      }

      const ok = await kvPut(env, body.type, payload);
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
