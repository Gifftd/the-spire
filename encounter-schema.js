// encounter-schema.js
// Shared schema, migration, and validation for the encounter builder.
// Loaded by encounter-dm.html, initiative-dm.html, map-dm.html,
// sessions-dm.html, crucible-dm.html, and tests/encounter-schema.test.html.
//
// The worker mirrors these rules in cloudflare-worker.js — keep both in sync.

(function (global) {
  'use strict';
  const STATUSES = ['draft', 'ready', 'scheduled', 'live', 'completed', 'archived'];
  const LIGHTING = ['bright', 'dim', 'dark', 'varied'];
  const SURPRISE = ['none', 'party', 'monsters', 'both'];
  const NPC_ROLES = ['ally', 'enemy', 'hostage', 'witness'];
  const LOCATION_REF_KINDS = ['world', 'submap'];
  const OUTCOMES = ['won', 'tpk', 'fled', 'skipped'];

  // Soft caps mirrored on worker.
  const CAPS = {
    picks: 50,
    waves: 20,
    loot: 50,
    npcRoles: 30,
    waveRound: 50,
  };

  function genId(prefix) {
    const rand = Math.floor(Math.random() * 1e9).toString(36);
    return `${prefix}_${Date.now()}_${rand}`;
  }

  function newEncounter(name) {
    const now = new Date().toISOString();
    return {
      id: genId('enc'),
      schemaVersion: 2,
      name: name || '',
      description: '',
      tags: [],
      status: 'draft',
      picks: [],
      party: { size: 4, level: 5 },
      totalXp: 0,
      monsterCount: 0,
      tactical: {
        terrain: '',
        lighting: 'bright',
        surprise: 'none',
        startingPositions: '',
        waves: [],
        readAloud: '',
      },
      playbook: {
        overallTactics: '',
        retreatTriggers: '',
        victoryConditions: '',
        reminders: '',
      },
      loot: [],
      locationRef: null,
      sessionId: null,
      npcRoles: [],
      createdAt: now,
      updatedAt: now,
      lastStagedAt: null,
      resolvedAt: null,
      resolvedInTimelineId: null,
      lastOutcome: null,
    };
  }

  function genPickKeys(picks) {
    if (!Array.isArray(picks)) return [];
    const seen = new Set();
    const out = picks.map(p => ({ ...p }));
    // Pass 1: keep unique existing keys.
    out.forEach(p => {
      if (typeof p.pickKey === 'string' && p.pickKey && !seen.has(p.pickKey)) {
        seen.add(p.pickKey);
      } else {
        p.pickKey = null;
      }
    });
    // Pass 2: assign the lowest unused pN to the unkeyed.
    let n = 1;
    out.forEach(p => {
      if (p.pickKey == null) {
        while (seen.has('p' + n)) n++;
        p.pickKey = 'p' + n;
        seen.add(p.pickKey);
      }
    });
    return out;
  }

  function migrateInMemory(rec) {
    if (rec && rec.schemaVersion === 2) return rec;
    const r = rec || {};
    const out = {
      id:            typeof r.id === 'string' && r.id ? r.id : genId('enc'),
      schemaVersion: 2,
      name:          r.name || '',
      description:   r.description || '',
      tags:          Array.isArray(r.tags) ? r.tags : [],
      status:        STATUSES.includes(r.status) ? r.status : 'ready',
      picks:         genPickKeys(Array.isArray(r.picks) ? r.picks : []),
      party:         (r.party && typeof r.party === 'object') ? { size: r.party.size || 4, level: r.party.level || 5 } : { size: 4, level: 5 },
      totalXp:       typeof r.totalXp === 'number' ? r.totalXp : 0,
      monsterCount:  typeof r.monsterCount === 'number' ? r.monsterCount : 0,
      tactical: {
        terrain:           (r.tactical && r.tactical.terrain) || '',
        lighting:          (r.tactical && LIGHTING.includes(r.tactical.lighting)) ? r.tactical.lighting : 'bright',
        surprise:          (r.tactical && SURPRISE.includes(r.tactical.surprise)) ? r.tactical.surprise : 'none',
        startingPositions: (r.tactical && r.tactical.startingPositions) || '',
        waves:             (r.tactical && Array.isArray(r.tactical.waves)) ? r.tactical.waves : [],
        readAloud:         (r.tactical && r.tactical.readAloud) || '',
      },
      playbook: {
        overallTactics:    (r.playbook && r.playbook.overallTactics) || '',
        retreatTriggers:   (r.playbook && r.playbook.retreatTriggers) || '',
        victoryConditions: (r.playbook && r.playbook.victoryConditions) || '',
        reminders:         (r.playbook && r.playbook.reminders) || '',
      },
      loot:        Array.isArray(r.loot) ? r.loot : [],
      locationRef: r.locationRef && typeof r.locationRef === 'object' ? r.locationRef : null,
      sessionId:   r.sessionId || null,
      npcRoles:    Array.isArray(r.npcRoles) ? r.npcRoles : [],
      createdAt:   r.createdAt || new Date().toISOString(),
      updatedAt:   r.updatedAt || r.createdAt || new Date().toISOString(),
      lastStagedAt:         r.lastStagedAt || null,
      resolvedAt:           r.resolvedAt || null,
      resolvedInTimelineId: r.resolvedInTimelineId || null,
      lastOutcome:          OUTCOMES.includes(r.lastOutcome) ? r.lastOutcome : null,
    };
    return out;
  }

  function validateEncounter(e) {
    const errors = [];
    const push = (field, message) => errors.push({ field, message });

    if (!e || typeof e !== 'object') {
      push('', 'encounter must be an object');
      return { ok: false, errors };
    }

    if (!STATUSES.includes(e.status)) push('status', `unknown status: ${e.status}`);

    // Tactical enums
    if (e.tactical) {
      if (!LIGHTING.includes(e.tactical.lighting)) push('tactical.lighting', `unknown lighting: ${e.tactical.lighting}`);
      if (!SURPRISE.includes(e.tactical.surprise)) push('tactical.surprise', `unknown surprise: ${e.tactical.surprise}`);
    }

    // Picks: cap + pickKey uniqueness (when present)
    let keyed = null;  // null = picks wasn't an array, so we can't check pickKey refs

    if (Array.isArray(e.picks)) {
      if (e.picks.length > CAPS.picks) push('picks', `too many picks (max ${CAPS.picks})`);
      const seen = new Set();
      keyed = new Set();
      e.picks.forEach((p, i) => {
        if (p && typeof p.pickKey === 'string' && p.pickKey) {
          if (seen.has(p.pickKey)) push('picks', `duplicate pickKey "${p.pickKey}" at index ${i}`);
          seen.add(p.pickKey);
          keyed.add(p.pickKey);
        }
      });
    }

    if (e.tactical && Array.isArray(e.tactical.waves)) {
      if (e.tactical.waves.length > CAPS.waves) push('tactical.waves', `too many waves (max ${CAPS.waves})`);
      e.tactical.waves.forEach((w, i) => {
        if (!w || typeof w !== 'object') { push(`tactical.waves[${i}]`, 'must be an object'); return; }
        if (typeof w.round !== 'number' || w.round < 1 || w.round > CAPS.waveRound) {
          push(`tactical.waves[${i}].round`, `round must be 1..${CAPS.waveRound}`);
        }
        // pickKey referential integrity only fires when we have a keyed set from picks
        if (keyed !== null && w.pickKey && !keyed.has(w.pickKey)) {
          push(`tactical.waves[${i}].pickKey`, `references missing pickKey "${w.pickKey}"`);
        }
      });
    }

    if (Array.isArray(e.loot) && e.loot.length > CAPS.loot) push('loot', `too many loot rows (max ${CAPS.loot})`);
    if (Array.isArray(e.npcRoles)) {
      if (e.npcRoles.length > CAPS.npcRoles) push('npcRoles', `too many npc roles (max ${CAPS.npcRoles})`);
      e.npcRoles.forEach((r, i) => {
        if (!r || typeof r !== 'object') { push(`npcRoles[${i}]`, 'must be an object'); return; }
        if (!NPC_ROLES.includes(r.role)) push(`npcRoles[${i}].role`, `unknown role: ${r.role}`);
      });
    }

    if (e.locationRef !== null && e.locationRef !== undefined) {
      const ref = e.locationRef;
      if (typeof ref !== 'object') push('locationRef', 'must be null or an object');
      else {
        if (!LOCATION_REF_KINDS.includes(ref.kind)) push('locationRef.kind', `unknown kind: ${ref.kind}`);
        if (typeof ref.locationId !== 'string' || !ref.locationId) push('locationRef.locationId', 'required');
        if (ref.kind === 'submap' && (typeof ref.parentLocationId !== 'string' || !ref.parentLocationId)) {
          push('locationRef.parentLocationId', 'required for kind=submap');
        }
      }
    }

    if (e.lastOutcome != null && !OUTCOMES.includes(e.lastOutcome)) {
      push('lastOutcome', `unknown outcome: ${e.lastOutcome}`);
    }

    return { ok: errors.length === 0, errors };
  }

  function equalLocationRefs(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.kind !== b.kind) return false;
    if (a.locationId !== b.locationId) return false;
    if (a.kind === 'submap' && a.parentLocationId !== b.parentLocationId) return false;
    return true;
  }

  function resolveLocationRef(ref, worldData) {
    if (!ref || !worldData || !Array.isArray(worldData.locations)) return null;
    if (ref.kind === 'world') {
      const loc = worldData.locations.find(l => l.id === ref.locationId);
      return loc ? { location: loc, parent: null } : null;
    }
    if (ref.kind === 'submap') {
      const parent = worldData.locations.find(l => l.id === ref.parentLocationId);
      if (!parent || !parent.subMap || !Array.isArray(parent.subMap.locations)) return null;
      const loc = parent.subMap.locations.find(l => l.id === ref.locationId);
      return loc ? { location: loc, parent } : null;
    }
    return null;
  }

  const EncounterSchema = {
    STATUSES, LIGHTING, SURPRISE, NPC_ROLES, LOCATION_REF_KINDS, OUTCOMES, CAPS,
    newEncounter, genId, genPickKeys, migrateInMemory, validateEncounter,
    equalLocationRefs, resolveLocationRef,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = EncounterSchema;
  } else {
    global.EncounterSchema = EncounterSchema;
  }
})(typeof window !== 'undefined' ? window : globalThis);
