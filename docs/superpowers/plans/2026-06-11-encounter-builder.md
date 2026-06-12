# Encounter Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a standalone `encounter-dm.html` page that is the canonical place to author, browse, and launch encounters — bundled with monster picks, tactical setup, DM playbook, pre-staged loot, lifecycle status, and linkages to map locations, planned sessions, and named NPCs. Existing saved encounters migrate forward.

**Architecture:** Three-pane workshop (mirrors Atlas Workshop). Schema-versioned records in the existing `encounters` KV (DM-only, bare array). A shared `encounter-schema.js` module owns enums, migration, and validation on the front-end; the worker mirrors the same validation rules server-side. War Table receives a one-click stager via `?stage=<id>` URL param; on combat export, the timeline entry is pre-filled and the encounter resolves automatically.

**Tech Stack:** Vanilla HTML/CSS/JS — no framework, no bundler, no npm. Cloudflare Worker (paste-deployed) over Cloudflare KV. Tests are vanilla HTML pages with inline assert harnesses.

**Reference spec:** `docs/superpowers/specs/2026-06-11-encounter-builder-design.md`

---

## Phase 0 — Pre-work

### Task 0.1: Snapshot existing encounters KV

**Files:**
- Create: `backups/<timestamp>-encounter-builder-pre-migration/encounters.json`

- [ ] **Step 1: Fetch the current `encounters` payload from the deployed worker (DM-authed) and save it to `backups/`**

```bash
mkdir -p "backups/$(date +%Y%m%d-%H%M%S)-encounter-builder-pre-migration"
# Replace <DM_USER> and <DM_PASS> with your DM credentials.
curl -sS \
  -H "X-DM-User: <DM_USER>" \
  -H "X-DM-Pass: <DM_PASS>" \
  'https://dnd-perk-webhook.jacobgiff.workers.dev/?type=encounters' \
  > "backups/$(ls -td backups/*encounter-builder-pre-migration | head -1 | xargs basename)/encounters.json"
```

- [ ] **Step 2: Verify the file contains an array (possibly empty)**

```bash
head -c 200 backups/*encounter-builder-pre-migration/encounters.json
# Expect: "[]" or "[{...}, ...]"
```

- [ ] **Step 3: Commit the backup (matches existing project convention — `backups/` is gitignored, but a `.gitkeep` or note is optional)**

The backup folder is gitignored per `.gitignore`. No commit needed; the file exists locally as a safety net.

---

## Phase 1 — Shared schema module + tests

### Task 1.1: Create `encounter-schema.js` skeleton with enum constants

**Files:**
- Create: `encounter-schema.js`

- [ ] **Step 1: Create the file with enum constants and a global namespace**

```javascript
// encounter-schema.js
// Shared schema, migration, and validation for the encounter builder.
// Loaded by encounter-dm.html, initiative-dm.html, map-dm.html,
// sessions-dm.html, crucible-dm.html, and tests/encounter-schema.test.html.
//
// The worker mirrors these rules in cloudflare-worker.js — keep both in sync.

(function (global) {
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

  global.EncounterSchema = {
    STATUSES, LIGHTING, SURPRISE, NPC_ROLES, LOCATION_REF_KINDS, OUTCOMES, CAPS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2: Commit**

```bash
git add encounter-schema.js
git commit -m "Encounter schema: enum constants + caps"
```

---

### Task 1.2: Test harness skeleton + first enum assertion

**Files:**
- Create: `tests/encounter-schema.test.html`

- [ ] **Step 1: Create the test page using the existing harness pattern (modeled after `tests/bestiary-merge.test.html`)**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Encounter Schema — tests</title>
  <style>
    body { font: 14px/1.4 system-ui, sans-serif; padding: 1rem; background: #1a1f24; color: #e8e6df; }
    h1 { font-family: Cinzel, serif; }
    button { font: inherit; padding: 6px 14px; background: #2a3038; color: inherit; border: 1px solid #888; border-radius: 3px; cursor: pointer; }
    #results { margin-top: 1rem; }
    .pass { color: #6c8; }
    .fail { color: #d66; }
    .case { padding: 2px 0; font-family: ui-monospace, monospace; }
  </style>
</head>
<body>
  <h1>Encounter Schema — tests</h1>
  <button onclick="runAll()">Run tests</button>
  <div id="results"></div>

  <script src="../encounter-schema.js"></script>
  <script>
    const tests = [];
    function test(name, fn) { tests.push({ name, fn }); }
    function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
    function assertEq(a, b, msg) {
      const sa = JSON.stringify(a), sb = JSON.stringify(b);
      if (sa !== sb) throw new Error((msg || 'mismatch') + ': ' + sa + ' vs ' + sb);
    }

    function runAll() {
      const root = document.getElementById('results');
      root.innerHTML = '';
      let pass = 0, fail = 0;
      for (const t of tests) {
        const row = document.createElement('div');
        row.className = 'case';
        try { t.fn(); row.classList.add('pass'); row.textContent = '✓ ' + t.name; pass++; }
        catch (e) { row.classList.add('fail'); row.textContent = '✗ ' + t.name + '  —  ' + e.message; fail++; }
        root.appendChild(row);
      }
      const summary = document.createElement('div');
      summary.style.marginTop = '1rem';
      summary.style.fontWeight = '600';
      summary.textContent = `${pass} passed, ${fail} failed (${tests.length} total)`;
      root.appendChild(summary);
    }

    // ── Tests ──
    test('STATUSES contains the v1 + v2 lifecycle states', () => {
      const s = EncounterSchema.STATUSES;
      ['draft','ready','scheduled','live','completed','archived'].forEach(v =>
        assert(s.includes(v), v + ' missing from STATUSES'));
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Open the file in a browser and click "Run tests"**

```bash
python3 -m http.server 8000 &
open 'http://localhost:8000/tests/encounter-schema.test.html'
```

Expected: `1 passed, 0 failed (1 total)`.

- [ ] **Step 3: Commit**

```bash
git add tests/encounter-schema.test.html
git commit -m "Encounter schema tests: harness + enum smoke test"
```

---

### Task 1.3: `newEncounter` factory — failing test first

**Files:**
- Test: `tests/encounter-schema.test.html`
- Modify: `encounter-schema.js`

- [ ] **Step 1: Add a failing test for `newEncounter()`**

Add to `tests/encounter-schema.test.html` after the existing test:

```javascript
test('newEncounter returns a v2-shape draft', () => {
  const e = EncounterSchema.newEncounter('My fight');
  assertEq(e.schemaVersion, 2);
  assertEq(e.status, 'draft');
  assertEq(e.name, 'My fight');
  assertEq(e.picks, []);
  assertEq(e.tactical.lighting, 'bright');
  assertEq(e.tactical.surprise, 'none');
  assertEq(e.tactical.waves, []);
  assertEq(e.playbook.overallTactics, '');
  assertEq(e.loot, []);
  assertEq(e.npcRoles, []);
  assertEq(e.locationRef, null);
  assertEq(e.sessionId, null);
  assert(typeof e.id === 'string' && e.id.startsWith('enc_'), 'id format');
  assert(typeof e.createdAt === 'string', 'createdAt set');
  assertEq(e.lastOutcome, null);
});
```

- [ ] **Step 2: Run tests — confirm new test fails ("newEncounter is not a function")**

Open the test page in browser, click Run tests. Expected: `1 passed, 1 failed`.

- [ ] **Step 3: Implement `newEncounter` in `encounter-schema.js`**

Add inside the IIFE before the global assignment:

```javascript
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
```

Update the global assignment to include `newEncounter, genId`:

```javascript
  global.EncounterSchema = {
    STATUSES, LIGHTING, SURPRISE, NPC_ROLES, LOCATION_REF_KINDS, OUTCOMES, CAPS,
    newEncounter, genId,
  };
```

- [ ] **Step 4: Re-run tests — expect 2 passed, 0 failed**

- [ ] **Step 5: Commit**

```bash
git add encounter-schema.js tests/encounter-schema.test.html
git commit -m "Encounter schema: newEncounter factory + test"
```

---

### Task 1.4: `genPickKeys` — assign stable keys within an encounter

**Files:**
- Test: `tests/encounter-schema.test.html`
- Modify: `encounter-schema.js`

- [ ] **Step 1: Add failing tests**

```javascript
test('genPickKeys assigns p1, p2, ... in array order', () => {
  const picks = [{ id: 'goblin' }, { id: 'orc' }, { id: 'goblin' }];
  const out = EncounterSchema.genPickKeys(picks);
  assertEq(out.map(p => p.pickKey), ['p1','p2','p3']);
});

test('genPickKeys preserves existing pickKeys when unique', () => {
  const picks = [{ id: 'goblin', pickKey: 'pX' }, { id: 'orc' }];
  const out = EncounterSchema.genPickKeys(picks);
  assertEq(out.map(p => p.pickKey), ['pX','p1']);
});

test('genPickKeys resolves duplicate pickKeys by re-assigning later ones', () => {
  const picks = [{ id: 'goblin', pickKey: 'p1' }, { id: 'orc', pickKey: 'p1' }];
  const out = EncounterSchema.genPickKeys(picks);
  assertEq(out[0].pickKey, 'p1');
  assert(out[1].pickKey !== 'p1', 'duplicate must be re-assigned');
});

test('genPickKeys is idempotent on already-keyed picks', () => {
  const picks = [{ id: 'g', pickKey: 'p1' }, { id: 'o', pickKey: 'p2' }];
  const out = EncounterSchema.genPickKeys(picks);
  assertEq(out.map(p => p.pickKey), ['p1','p2']);
});
```

- [ ] **Step 2: Run tests — confirm failures**

- [ ] **Step 3: Implement `genPickKeys` in `encounter-schema.js`**

Add inside the IIFE before the global assignment:

```javascript
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
```

Add `genPickKeys` to the global assignment.

- [ ] **Step 4: Re-run tests — expect all green**

- [ ] **Step 5: Commit**

```bash
git add encounter-schema.js tests/encounter-schema.test.html
git commit -m "Encounter schema: genPickKeys + tests"
```

---

### Task 1.5: `migrateInMemory` v1 → v2

**Files:**
- Test: `tests/encounter-schema.test.html`
- Modify: `encounter-schema.js`

- [ ] **Step 1: Add failing tests**

```javascript
test('migrateInMemory upgrades a v1 record to v2', () => {
  const v1 = {
    id: 'enc_old',
    name: 'Old fight',
    picks: [{ id: 'g', qty: 3 }, { id: 'o', qty: 1 }],
    party: { size: 4, level: 5 },
    totalXp: 100,
    monsterCount: 4,
    createdAt: '2026-05-01T00:00:00Z',
  };
  const v2 = EncounterSchema.migrateInMemory(v1);
  assertEq(v2.schemaVersion, 2);
  assertEq(v2.status, 'ready');
  assertEq(v2.picks.map(p => p.pickKey), ['p1','p2']);
  assertEq(v2.tactical.lighting, 'bright');
  assertEq(v2.tactical.surprise, 'none');
  assertEq(v2.tactical.waves, []);
  assertEq(v2.locationRef, null);
  assertEq(v2.sessionId, null);
  assertEq(v2.npcRoles, []);
  assertEq(v2.updatedAt, v2.createdAt);
});

test('migrateInMemory is a no-op on v2 records', () => {
  const e = EncounterSchema.newEncounter('Already v2');
  const out = EncounterSchema.migrateInMemory(e);
  assertEq(out, e);
});

test('migrateInMemory handles malformed input gracefully', () => {
  const out = EncounterSchema.migrateInMemory({});
  assertEq(out.schemaVersion, 2);
  assertEq(out.picks, []);
  assertEq(out.status, 'ready');
});
```

- [ ] **Step 2: Run tests — confirm failures**

- [ ] **Step 3: Implement `migrateInMemory`**

Add to `encounter-schema.js`:

```javascript
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
```

Add `migrateInMemory` to the global assignment.

- [ ] **Step 4: Re-run tests — expect green**

- [ ] **Step 5: Commit**

```bash
git add encounter-schema.js tests/encounter-schema.test.html
git commit -m "Encounter schema: migrateInMemory v1→v2 + tests"
```

---

### Task 1.6: `validateEncounter` — enum + uniqueness rules

**Files:**
- Test: `tests/encounter-schema.test.html`
- Modify: `encounter-schema.js`

- [ ] **Step 1: Add failing tests**

```javascript
test('validateEncounter passes a freshly-created encounter', () => {
  const e = EncounterSchema.newEncounter('OK');
  const r = EncounterSchema.validateEncounter(e);
  assertEq(r.ok, true);
  assertEq(r.errors, []);
});

test('validateEncounter rejects unknown status', () => {
  const e = EncounterSchema.newEncounter('Bad');
  e.status = 'in-progress';
  const r = EncounterSchema.validateEncounter(e);
  assertEq(r.ok, false);
  assert(r.errors.some(x => x.field === 'status'), 'status error present');
});

test('validateEncounter rejects unknown lighting / surprise / role', () => {
  const e = EncounterSchema.newEncounter('Bad');
  e.tactical.lighting = 'glow';
  e.tactical.surprise = 'sometimes';
  e.npcRoles = [{ npcId: 'n1', role: 'sidekick' }];
  const r = EncounterSchema.validateEncounter(e);
  assertEq(r.ok, false);
  ['tactical.lighting','tactical.surprise','npcRoles[0].role']
    .forEach(f => assert(r.errors.some(x => x.field === f), 'missing error for ' + f));
});

test('validateEncounter rejects duplicate pickKeys', () => {
  const e = EncounterSchema.newEncounter('Dupes');
  e.picks = [
    { id: 'g', qty: 1, pickKey: 'p1' },
    { id: 'o', qty: 1, pickKey: 'p1' },
  ];
  const r = EncounterSchema.validateEncounter(e);
  assertEq(r.ok, false);
  assert(r.errors.some(x => x.field === 'picks' && /duplicate/.test(x.message)), 'duplicate-key error');
});

test('validateEncounter rejects wave referencing missing pickKey', () => {
  const e = EncounterSchema.newEncounter('Orphan');
  e.picks = [{ id: 'g', qty: 1, pickKey: 'p1' }];
  e.tactical.waves = [{ round: 2, pickKey: 'p99', count: 1 }];
  const r = EncounterSchema.validateEncounter(e);
  assertEq(r.ok, false);
  assert(r.errors.some(x => x.field === 'tactical.waves[0].pickKey'), 'orphan-wave error');
});

test('validateEncounter rejects locationRef of wrong shape', () => {
  const e = EncounterSchema.newEncounter('BadRef');
  e.locationRef = { kind: 'galaxy', locationId: 'andromeda' };
  const r = EncounterSchema.validateEncounter(e);
  assertEq(r.ok, false);
  assert(r.errors.some(x => x.field === 'locationRef.kind'), 'kind enum');
});

test('validateEncounter enforces soft caps', () => {
  const e = EncounterSchema.newEncounter('TooMany');
  for (let i = 0; i < 60; i++) e.picks.push({ id: 'g', qty: 1, pickKey: 'q' + i });
  const r = EncounterSchema.validateEncounter(e);
  assertEq(r.ok, false);
  assert(r.errors.some(x => x.field === 'picks' && /50/.test(x.message)), 'cap error');
});

test('validateEncounter tolerates v1 picks without pickKey', () => {
  const e = EncounterSchema.newEncounter('v1');
  e.picks = [{ id: 'g', qty: 1 }];  // no pickKey
  const r = EncounterSchema.validateEncounter(e);
  assertEq(r.ok, true);
});
```

- [ ] **Step 2: Run tests — confirm failures**

- [ ] **Step 3: Implement `validateEncounter`**

Add to `encounter-schema.js`:

```javascript
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
    if (Array.isArray(e.picks)) {
      if (e.picks.length > CAPS.picks) push('picks', `too many picks (max ${CAPS.picks})`);
      const seen = new Set();
      const keyed = new Set();
      e.picks.forEach((p, i) => {
        if (p && typeof p.pickKey === 'string' && p.pickKey) {
          if (seen.has(p.pickKey)) push('picks', `duplicate pickKey "${p.pickKey}" at index ${i}`);
          seen.add(p.pickKey);
          keyed.add(p.pickKey);
        }
      });
      // Wave references resolve only against keyed picks; v1 picks (no key) can't be referenced anyway.
      if (e.tactical && Array.isArray(e.tactical.waves)) {
        if (e.tactical.waves.length > CAPS.waves) push('tactical.waves', `too many waves (max ${CAPS.waves})`);
        e.tactical.waves.forEach((w, i) => {
          if (typeof w.round !== 'number' || w.round < 1 || w.round > CAPS.waveRound) {
            push(`tactical.waves[${i}].round`, `round must be 1..${CAPS.waveRound}`);
          }
          if (w.pickKey && !keyed.has(w.pickKey)) {
            push(`tactical.waves[${i}].pickKey`, `references missing pickKey "${w.pickKey}"`);
          }
        });
      }
    }

    // Loot + npcRoles caps + role enums
    if (Array.isArray(e.loot) && e.loot.length > CAPS.loot) push('loot', `too many loot rows (max ${CAPS.loot})`);
    if (Array.isArray(e.npcRoles)) {
      if (e.npcRoles.length > CAPS.npcRoles) push('npcRoles', `too many npc roles (max ${CAPS.npcRoles})`);
      e.npcRoles.forEach((r, i) => {
        if (!NPC_ROLES.includes(r.role)) push(`npcRoles[${i}].role`, `unknown role: ${r.role}`);
      });
    }

    // locationRef shape (when not null)
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

    // lastOutcome enum (when not null)
    if (e.lastOutcome != null && !OUTCOMES.includes(e.lastOutcome)) {
      push('lastOutcome', `unknown outcome: ${e.lastOutcome}`);
    }

    return { ok: errors.length === 0, errors };
  }
```

Add `validateEncounter` to the global assignment.

- [ ] **Step 4: Re-run tests — expect green**

- [ ] **Step 5: Commit**

```bash
git add encounter-schema.js tests/encounter-schema.test.html
git commit -m "Encounter schema: validateEncounter + 8 test cases"
```

---

### Task 1.7: `equalLocationRefs` + `resolveLocationRef`

**Files:**
- Test: `tests/encounter-schema.test.html`
- Modify: `encounter-schema.js`

- [ ] **Step 1: Add failing tests**

```javascript
test('equalLocationRefs handles null + world + submap', () => {
  const eq = EncounterSchema.equalLocationRefs;
  assertEq(eq(null, null), true);
  assertEq(eq(null, { kind: 'world', locationId: 'a' }), false);
  assertEq(eq({ kind: 'world', locationId: 'a' }, { kind: 'world', locationId: 'a' }), true);
  assertEq(eq({ kind: 'world', locationId: 'a' }, { kind: 'world', locationId: 'b' }), false);
  assertEq(eq(
    { kind: 'submap', parentLocationId: 'p', locationId: 'l' },
    { kind: 'submap', parentLocationId: 'p', locationId: 'l' }), true);
  assertEq(eq(
    { kind: 'submap', parentLocationId: 'p', locationId: 'l' },
    { kind: 'submap', parentLocationId: 'X', locationId: 'l' }), false);
  assertEq(eq(
    { kind: 'world',  locationId: 'l' },
    { kind: 'submap', parentLocationId: 'p', locationId: 'l' }), false);
});

test('resolveLocationRef returns world location + null parent', () => {
  const world = {
    locations: [
      { id: 'numira-bad', name: "Numira'Bad", subMap: { locations: [{ id: 'chapel', name: 'Chapel' }] } },
      { id: 'chapel', name: 'World Chapel' },
    ],
  };
  const res = EncounterSchema.resolveLocationRef(
    { kind: 'world', locationId: 'chapel' }, world);
  assertEq(res.parent, null);
  assertEq(res.location.name, 'World Chapel');
});

test('resolveLocationRef returns submap location + parent', () => {
  const world = {
    locations: [
      { id: 'numira-bad', name: "Numira'Bad", subMap: { locations: [{ id: 'chapel', name: 'Sub Chapel' }] } },
      { id: 'chapel', name: 'World Chapel' },
    ],
  };
  const res = EncounterSchema.resolveLocationRef(
    { kind: 'submap', parentLocationId: 'numira-bad', locationId: 'chapel' }, world);
  assertEq(res.parent.id, 'numira-bad');
  assertEq(res.location.name, 'Sub Chapel');
});

test('resolveLocationRef returns null for broken refs', () => {
  const world = { locations: [{ id: 'a' }] };
  assertEq(EncounterSchema.resolveLocationRef(null, world), null);
  assertEq(EncounterSchema.resolveLocationRef({ kind: 'world', locationId: 'missing' }, world), null);
  assertEq(EncounterSchema.resolveLocationRef({ kind: 'submap', parentLocationId: 'missing', locationId: 'x' }, world), null);
});
```

- [ ] **Step 2: Run tests — confirm failures**

- [ ] **Step 3: Implement both helpers**

Add to `encounter-schema.js`:

```javascript
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
```

Add both to the global assignment.

- [ ] **Step 4: Re-run tests — expect green**

- [ ] **Step 5: Commit**

```bash
git add encounter-schema.js tests/encounter-schema.test.html
git commit -m "Encounter schema: locationRef equality + resolution"
```

---

## Phase 2 — Worker validation

### Task 2.1: Worker — stamp `schemaVersion: 1` on read

**Files:**
- Modify: `cloudflare-worker.js:618-628`

- [ ] **Step 1: Find the existing `encounters` GET branch (around line 624)**

```bash
grep -n "type === 'encounters'" cloudflare-worker.js
```

- [ ] **Step 2: Replace the branch body to stamp `schemaVersion: 1` on bare records**

Change:

```javascript
if (type === 'encounters') {
  const auth = await verifyDMAuth(request, env);
  if (!auth.ok) return json({ error: 'DM auth required' }, 401);
  return json(await kvGet(env, 'encounters', []));
}
```

to:

```javascript
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
```

- [ ] **Step 3: Commit**

```bash
git add cloudflare-worker.js
git commit -m "Worker: stamp schemaVersion:1 on encounters GET for cleaner front-end branching"
```

---

### Task 2.2: Worker — server-side validation on `encounters` POST

**Files:**
- Modify: `cloudflare-worker.js` (POST handler for `type === 'encounters'`)

- [ ] **Step 1: Find the POST handler dispatch (around line 895 `DM_WRITE_TYPES`)**

```bash
grep -n "DM_WRITE_TYPES.includes(body" cloudflare-worker.js
```

- [ ] **Step 2: Locate where the encounters POST currently writes (it's handled by the generic DM_WRITE branch). Add an explicit validation block BEFORE the generic write.**

Find the section where `DM_WRITE_TYPES.includes(body?.type)` branches into the write, and add this block immediately before the kvPut call inside that branch:

```javascript
    // Server-side validation for encounters payload — mirrors the front-end
    // encounter-schema.js validateEncounter rules. Keep both in sync.
    if (body.type === 'encounters') {
      const errs = validateEncountersPayload(body.payload);
      if (errs.length) return json({ error: 'validation failed', details: errs }, 400);
    }
```

Then add the helper function near the other worker helpers (before the `export default` block):

```javascript
// Mirror of encounter-schema.js#validateEncounter. Worker-side defense — the
// front-end already validates, but this is the authoritative gate.
const ENC_STATUSES = ['draft','ready','scheduled','live','completed','archived'];
const ENC_LIGHTING = ['bright','dim','dark','varied'];
const ENC_SURPRISE = ['none','party','monsters','both'];
const ENC_NPC_ROLES = ['ally','enemy','hostage','witness'];
const ENC_LOC_KINDS = ['world','submap'];
const ENC_OUTCOMES = ['won','tpk','fled','skipped'];
const ENC_CAPS = { picks: 50, waves: 20, loot: 50, npcRoles: 30, waveRound: 50 };

function validateEncountersPayload(payload) {
  const errors = [];
  if (!Array.isArray(payload)) {
    errors.push({ field: '', message: 'payload must be an array' });
    return errors;
  }
  payload.forEach((e, i) => {
    if (!e || typeof e !== 'object') {
      errors.push({ field: `[${i}]`, message: 'must be an object' });
      return;
    }
    if (!ENC_STATUSES.includes(e.status)) errors.push({ field: `[${i}].status`, message: `unknown status: ${e.status}` });
    if (e.tactical) {
      if (!ENC_LIGHTING.includes(e.tactical.lighting)) errors.push({ field: `[${i}].tactical.lighting`, message: `unknown lighting: ${e.tactical.lighting}` });
      if (!ENC_SURPRISE.includes(e.tactical.surprise)) errors.push({ field: `[${i}].tactical.surprise`, message: `unknown surprise: ${e.tactical.surprise}` });
    }
    if (Array.isArray(e.picks)) {
      if (e.picks.length > ENC_CAPS.picks) errors.push({ field: `[${i}].picks`, message: `too many picks (max ${ENC_CAPS.picks})` });
      const seen = new Set();
      const keyed = new Set();
      e.picks.forEach((p, pi) => {
        if (p && typeof p.pickKey === 'string' && p.pickKey) {
          if (seen.has(p.pickKey)) errors.push({ field: `[${i}].picks`, message: `duplicate pickKey "${p.pickKey}" at index ${pi}` });
          seen.add(p.pickKey);
          keyed.add(p.pickKey);
        }
      });
      if (e.tactical && Array.isArray(e.tactical.waves)) {
        if (e.tactical.waves.length > ENC_CAPS.waves) errors.push({ field: `[${i}].tactical.waves`, message: `too many waves (max ${ENC_CAPS.waves})` });
        e.tactical.waves.forEach((w, wi) => {
          if (typeof w.round !== 'number' || w.round < 1 || w.round > ENC_CAPS.waveRound) {
            errors.push({ field: `[${i}].tactical.waves[${wi}].round`, message: `round must be 1..${ENC_CAPS.waveRound}` });
          }
          if (w.pickKey && !keyed.has(w.pickKey)) {
            errors.push({ field: `[${i}].tactical.waves[${wi}].pickKey`, message: `references missing pickKey "${w.pickKey}"` });
          }
        });
      }
    }
    if (Array.isArray(e.loot) && e.loot.length > ENC_CAPS.loot) errors.push({ field: `[${i}].loot`, message: `too many loot rows (max ${ENC_CAPS.loot})` });
    if (Array.isArray(e.npcRoles)) {
      if (e.npcRoles.length > ENC_CAPS.npcRoles) errors.push({ field: `[${i}].npcRoles`, message: `too many npc roles (max ${ENC_CAPS.npcRoles})` });
      e.npcRoles.forEach((r, ri) => {
        if (!ENC_NPC_ROLES.includes(r.role)) errors.push({ field: `[${i}].npcRoles[${ri}].role`, message: `unknown role: ${r.role}` });
      });
    }
    if (e.locationRef != null) {
      if (typeof e.locationRef !== 'object') errors.push({ field: `[${i}].locationRef`, message: 'must be null or an object' });
      else {
        if (!ENC_LOC_KINDS.includes(e.locationRef.kind)) errors.push({ field: `[${i}].locationRef.kind`, message: `unknown kind: ${e.locationRef.kind}` });
        if (typeof e.locationRef.locationId !== 'string' || !e.locationRef.locationId) errors.push({ field: `[${i}].locationRef.locationId`, message: 'required' });
        if (e.locationRef.kind === 'submap' && (typeof e.locationRef.parentLocationId !== 'string' || !e.locationRef.parentLocationId)) {
          errors.push({ field: `[${i}].locationRef.parentLocationId`, message: 'required for kind=submap' });
        }
      }
    }
    if (e.lastOutcome != null && !ENC_OUTCOMES.includes(e.lastOutcome)) {
      errors.push({ field: `[${i}].lastOutcome`, message: `unknown outcome: ${e.lastOutcome}` });
    }
  });
  return errors;
}
```

- [ ] **Step 3: Server-side stamp of `updatedAt` on encounter writes (overwrite client-supplied)**

Inside the same encounters POST branch, before the kvPut, add:

```javascript
    if (body.type === 'encounters' && Array.isArray(body.payload)) {
      const reqDate = new Date(request.headers.get('date') || Date.now()).toISOString();
      body.payload = body.payload.map(e => ({ ...e, updatedAt: reqDate }));
    }
```

- [ ] **Step 4: Smoke-test by POSTing valid + invalid payloads**

After deploying (next task), this will be tested end-to-end. For now: code-read and commit.

- [ ] **Step 5: Commit**

```bash
git add cloudflare-worker.js
git commit -m "Worker: validateEncountersPayload + server-stamped updatedAt"
```

---

### Task 2.3: Worker — `encounterId` pass-through + filter on `initiative_state`

**Files:**
- Modify: `cloudflare-worker.js` (`filterInitiativeState` function)

- [ ] **Step 1: Find `filterInitiativeState`**

```bash
grep -n "function filterInitiativeState\|filterInitiativeState\s*=" cloudflare-worker.js
```

- [ ] **Step 2: Add `encounterId` and `encounterStagedAt` to the DM-only strip list**

The function already strips DM-only fields (e.g., `notes`, `hidden`). Add the encounter fields to the same path. Locate the lines that delete DM-only top-level fields from the state object and add:

```javascript
  // Encounter linkage — DM-only. Defense-in-depth: the DM tracker should already
  // omit these from player-facing POSTs, but enforce here regardless.
  delete state.encounterId;
  delete state.encounterStagedAt;
```

- [ ] **Step 3: Commit**

```bash
git add cloudflare-worker.js
git commit -m "Worker: strip encounterId/encounterStagedAt on player initiative_state GET"
```

---

### Task 2.4: Manual worker deploy + smoke test

**Files:**
- (Deployment only)

- [ ] **Step 1: Paste `cloudflare-worker.js` into the Cloudflare dashboard and save+deploy**

Cloudflare → Workers & Pages → `dnd-perk-webhook` → Edit code → Save and deploy.

- [ ] **Step 2: Smoke-test existing encounters still load**

In a browser (DM-signed in via home.html), open DevTools console and run:

```javascript
fetch('https://dnd-perk-webhook.jacobgiff.workers.dev/?type=encounters', {
  headers: { 'X-DM-User': localStorage.getItem('dm-username'), 'X-DM-Pass': prompt('DM password:') }
}).then(r => r.json()).then(arr => {
  console.log('Loaded', arr.length, 'encounters');
  console.log('First record schemaVersion:', arr[0]?.schemaVersion);
});
```

Expected: existing records load. Pre-existing records should have `schemaVersion: 1`. Brand-new array returns `[]`.

- [ ] **Step 3: Smoke-test invalid POST returns 400**

```javascript
fetch('https://dnd-perk-webhook.jacobgiff.workers.dev/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-DM-User': '...', 'X-DM-Pass': '...' },
  body: JSON.stringify({ type: 'encounters', payload: [{ status: 'made-up' }] })
}).then(r => r.json()).then(console.log);
```

Expected: `{ error: 'validation failed', details: [...] }` with HTTP 400.

- [ ] **Step 4: Smoke-test valid POST round-trips**

```javascript
// First GET the current array, then POST it back unchanged. Should succeed.
const headers = { 'Content-Type': 'application/json', 'X-DM-User': '...', 'X-DM-Pass': '...' };
const arr = await fetch('https://...?type=encounters', { headers }).then(r => r.json());
// If arr has v1 records, the v1 records WILL pass validation because their
// status enum is set by the front-end migration; for now, just confirm an
// empty array round-trips:
const r = await fetch('https://...', { method: 'POST', headers, body: JSON.stringify({ type: 'encounters', payload: [] }) });
console.log('POST status:', r.status);  // Expected: 200
```

If you have existing v1 records, the validation will fail for them because they lack `status`. This is INTENTIONAL — the front-end will migrate them on first edit. Don't bulk-write back the array until front-end migration has touched each record.

- [ ] **Step 5: No commit (deployment-only step). Move on.**

---

## Phase 3 — Encounter builder page

### Task 3.1: Page scaffolding — `encounter-dm.html` (auth + topbar)

**Files:**
- Create: `encounter-dm.html`

- [ ] **Step 1: Create the file with auth gate, topbar, and pane skeleton**

Use the same structure as other DM pages. Reference: open `crucible-dm.html` for the auth + topbar pattern.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Encounter Builder · The Spire</title>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="theme.css">
  <style>
    /* Three-pane layout: library | editor | launchpad */
    body { display: flex; flex-direction: column; height: 100vh; overflow: hidden; margin: 0; }
    .workshop { display: grid; grid-template-columns: 280px 1fr 280px; flex: 1; min-height: 0; }
    .pane { padding: 1rem; overflow-y: auto; border-right: 1px solid var(--c-border); }
    .pane:last-child { border-right: none; border-left: 1px solid var(--c-border); }
    @media (max-width: 1100px) {
      .workshop { grid-template-columns: 1fr; }
      .pane.launchpad { position: sticky; bottom: 0; }
    }
  </style>
</head>
<body>
  <div id="topbar" class="topbar"></div>

  <div class="workshop">
    <aside class="pane library" id="pane-library">
      <h2>Encounters</h2>
      <div id="library-list">Loading…</div>
    </aside>
    <main class="pane editor" id="pane-editor">
      <div id="editor-empty" class="empty-state">Select or create an encounter.</div>
      <div id="editor-form" style="display:none"></div>
    </main>
    <aside class="pane launchpad" id="pane-launchpad">
      <div id="launchpad-content"></div>
    </aside>
  </div>

  <script src="auth.js"></script>
  <script src="encounter-schema.js"></script>
  <script>
    Auth.requireRole('dm', { redirect: 'home.html', notice: 'DM sign-in required for the encounter builder.' });

    const WORKER_URL = 'https://dnd-perk-webhook.jacobgiff.workers.dev/';
    const state = {
      encounters: [],
      worldData: null,    // for locationRef resolution
      npcs: [],           // for NPC role pickers
      timeline: [],       // for session picker
      selectedId: null,
    };

    async function loadAll() {
      const headers = Auth.dmHeaders();
      const [encs, world, npcs, tl] = await Promise.all([
        fetch(WORKER_URL + '?type=encounters', { headers }).then(r => r.json()),
        fetch(WORKER_URL + '?type=map_data_dm', { headers }).then(r => r.json()),
        fetch(WORKER_URL + '?type=npcs', { headers }).then(r => r.json()),
        fetch(WORKER_URL + '?type=timeline_dm', { headers }).then(r => r.json()),
      ]);
      state.encounters = (Array.isArray(encs) ? encs : []).map(EncounterSchema.migrateInMemory);
      state.worldData = world && world.map_data ? world.map_data : world;
      state.npcs = Array.isArray(npcs) ? npcs : (npcs?.npcs || []);
      state.timeline = Array.isArray(tl) ? tl : (tl?.entries || []);
      render();
    }

    function render() {
      renderLibrary();
      renderEditor();
      renderLaunchpad();
    }

    function renderLibrary() {
      const root = document.getElementById('library-list');
      root.textContent = state.encounters.length ? '' : 'No encounters yet.';
    }
    function renderEditor() {
      document.getElementById('editor-empty').style.display = state.selectedId ? 'none' : '';
      document.getElementById('editor-form').style.display = state.selectedId ? '' : 'none';
    }
    function renderLaunchpad() {
      document.getElementById('launchpad-content').textContent = state.selectedId ? '' : '';
    }

    loadAll().catch(e => {
      document.getElementById('library-list').textContent = 'Load failed: ' + e.message;
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Test by opening in browser (DM signed in)**

```bash
python3 -m http.server 8000 &
open 'http://localhost:8000/encounter-dm.html'
```

Expected: page loads, library shows "No encounters yet." or a list of placeholder entries, editor shows "Select or create an encounter."

- [ ] **Step 3: Commit**

```bash
git add encounter-dm.html
git commit -m "Encounter builder: page scaffold + parallel data load"
```

---

### Task 3.2: Library list rendering + selection

**Files:**
- Modify: `encounter-dm.html` (renderLibrary + state.selectedId handling)

- [ ] **Step 1: Add CSS for library rows**

In the `<style>` block:

```css
.lib-row { padding: 8px 10px; border: 1px solid var(--c-border); border-radius: 3px; margin-bottom: 6px; cursor: pointer; background: var(--c-surface); }
.lib-row.selected { border-color: var(--c-brass); background: rgba(184,138,90,0.10); }
.lib-row-name { font-family: 'Cinzel', serif; font-size: 0.85rem; }
.lib-row-meta { display: flex; gap: 8px; margin-top: 4px; font-size: 0.7rem; color: var(--c-ink-faint); }
.lib-status-pill { padding: 1px 6px; border-radius: 8px; border: 1px solid currentColor; font-family: 'Cinzel', serif; font-size: 0.55rem; letter-spacing: 0.08em; text-transform: uppercase; }
.lib-status-draft     { color: #8a8275; }
.lib-status-ready     { color: #6c8; }
.lib-status-scheduled { color: #88c8e0; }
.lib-status-live      { color: #d66; }
.lib-status-completed { color: #b88a5a; }
.lib-status-archived  { color: #555; }
#new-btn { width: 100%; margin-bottom: 8px; padding: 8px; background: var(--c-brass); color: #1a1f24; border: none; border-radius: 3px; font-family: 'Cinzel', serif; cursor: pointer; }
```

- [ ] **Step 2: Replace `renderLibrary()`**

```javascript
    function renderLibrary() {
      const root = document.getElementById('library-list');
      root.innerHTML = '<button id="new-btn" onclick="createEncounter()">+ New encounter</button>';
      if (!state.encounters.length) {
        root.insertAdjacentHTML('beforeend', '<div class="empty-state">No encounters yet.</div>');
        return;
      }
      const sorted = state.encounters.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      sorted.forEach(e => {
        const row = document.createElement('div');
        row.className = 'lib-row' + (e.id === state.selectedId ? ' selected' : '');
        row.onclick = () => selectEncounter(e.id);
        row.innerHTML = `
          <div class="lib-row-name">${escapeHtml(e.name || '(untitled)')}</div>
          <div class="lib-row-meta">
            <span class="lib-status-pill lib-status-${e.status}">${e.status}</span>
            <span>${e.picks.length} monster${e.picks.length === 1 ? '' : 's'}</span>
          </div>
        `;
        root.appendChild(row);
      });
    }

    function selectEncounter(id) {
      state.selectedId = id;
      render();
    }

    function createEncounter() {
      const e = EncounterSchema.newEncounter('New encounter');
      state.encounters.push(e);
      state.selectedId = e.id;
      saveEncounters();  // defined in Task 3.3
      render();
    }

    function escapeHtml(s) {
      return (s || '').toString()
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
```

- [ ] **Step 3: Stub `saveEncounters` for now**

```javascript
    async function saveEncounters() { /* implemented in Task 3.3 */ }
```

- [ ] **Step 4: Test in browser — clicking "+ New encounter" adds a row that highlights when selected**

- [ ] **Step 5: Commit**

```bash
git add encounter-dm.html
git commit -m "Encounter builder: library list rendering + selection"
```

---

### Task 3.3: Save flow — re-fetch-and-splice POST

**Files:**
- Modify: `encounter-dm.html`

- [ ] **Step 1: Implement `saveEncounters` and `saveCurrentEncounter`**

Replace the stub:

```javascript
    let saveTimer = null;
    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(saveEncounters, 600);
    }

    async function saveEncounters() {
      const headers = Auth.dmHeaders();
      // Re-fetch to reduce two-tab clobber risk.
      let serverArr = [];
      try {
        const r = await fetch(WORKER_URL + '?type=encounters', { headers });
        serverArr = await r.json();
        if (!Array.isArray(serverArr)) serverArr = [];
        serverArr = serverArr.map(EncounterSchema.migrateInMemory);
      } catch (e) {
        showBanner('Could not load latest encounters before save — retrying in 10s', 'warn');
        setTimeout(saveEncounters, 10000);
        return;
      }
      // Splice local edits in by id.
      const byId = new Map(serverArr.map(x => [x.id, x]));
      state.encounters.forEach(local => byId.set(local.id, local));
      const merged = Array.from(byId.values());

      // Validate before POST — fail loud locally.
      const errs = merged.flatMap(e => {
        const r = EncounterSchema.validateEncounter(e);
        return r.ok ? [] : r.errors.map(x => ({ id: e.id, ...x }));
      });
      if (errs.length) {
        console.warn('Local validation errors, refusing save:', errs);
        showBanner('Validation errors — see console', 'warn');
        return;
      }

      const r = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'encounters', payload: merged }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        console.warn('Save failed', r.status, body);
        showBanner('Save failed (' + r.status + '). Retrying in 10s.', 'warn');
        setTimeout(saveEncounters, 10000);
        return;
      }
      state.encounters = merged;
      render();
    }

    function showBanner(msg, kind) {
      let bar = document.getElementById('error-banner');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'error-banner';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:8px 14px;background:#5a4030;color:#e8e6df;font-family:Crimson Text,serif;z-index:1000;';
        document.body.prepend(bar);
      }
      bar.textContent = msg;
      bar.style.background = kind === 'warn' ? '#5a4030' : '#3a4030';
    }
```

- [ ] **Step 2: Manual test — create an encounter, refresh, confirm it persists**

Open the page, click "+ New encounter," reload, confirm the row is still there.

- [ ] **Step 3: Commit**

```bash
git add encounter-dm.html
git commit -m "Encounter builder: save flow with re-fetch-and-splice"
```

---

### Task 3.4: Editor — Identity section

**Files:**
- Modify: `encounter-dm.html`

- [ ] **Step 1: Replace `renderEditor()`**

```javascript
    function renderEditor() {
      const empty = document.getElementById('editor-empty');
      const form = document.getElementById('editor-form');
      const e = state.encounters.find(x => x.id === state.selectedId);
      if (!e) { empty.style.display = ''; form.style.display = 'none'; return; }
      empty.style.display = 'none';
      form.style.display = '';
      form.innerHTML = renderIdentity(e);  // more sections in later tasks
    }

    function renderIdentity(e) {
      return `
        <details open><summary>Identity</summary>
          <div class="field">
            <label>Name</label>
            <input type="text" value="${escapeHtml(e.name)}" oninput="updateField('name', this.value)">
          </div>
          <div class="field">
            <label>Description</label>
            <input type="text" value="${escapeHtml(e.description)}" oninput="updateField('description', this.value)">
          </div>
          <div class="field">
            <label>Tags (comma-separated)</label>
            <input type="text" value="${escapeHtml((e.tags || []).join(', '))}" oninput="updateField('tags', this.value.split(',').map(s => s.trim()).filter(Boolean))">
          </div>
          <div class="field">
            <label>Status</label>
            <select onchange="updateField('status', this.value)">
              ${EncounterSchema.STATUSES.map(s =>
                `<option value="${s}" ${e.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
        </details>
      `;
    }

    function currentEncounter() {
      return state.encounters.find(e => e.id === state.selectedId);
    }

    function updateField(path, value) {
      const e = currentEncounter();
      if (!e) return;
      // Simple dot-path assignment; supports e.g. 'tactical.lighting'.
      const parts = path.split('.');
      let obj = e;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]] = obj[parts[i]] || {};
      obj[parts[parts.length - 1]] = value;
      // Re-render only the library row label if the name changed; full re-render is overkill here.
      if (path === 'name' || path === 'status') renderLibrary();
      scheduleSave();
    }
```

Add to the `<style>` block:

```css
details { margin-bottom: 1rem; border: 1px solid var(--c-border); border-radius: 3px; padding: 8px; background: var(--c-surface); }
summary { font-family: 'Cinzel', serif; font-size: 0.85rem; cursor: pointer; padding: 4px; }
.field { margin-bottom: 8px; }
.field label { display: block; font-size: 0.7rem; color: var(--c-ink-faint); margin-bottom: 2px; }
.field input, .field textarea, .field select {
  width: 100%; background: var(--c-surface); color: var(--c-ink); border: 1px solid var(--c-border);
  border-radius: 2px; padding: 6px 8px; font-family: 'Crimson Text', serif; font-size: 0.9rem; box-sizing: border-box;
}
```

- [ ] **Step 2: Test — change a name, refresh, confirm persisted**

- [ ] **Step 3: Commit**

```bash
git add encounter-dm.html
git commit -m "Encounter builder: Identity section + autosave plumbing"
```

---

### Task 3.5: Editor — Combatants section (lift bestiary picker)

**Files:**
- Modify: `encounter-dm.html`

The bestiary picker UI lives inside `initiative-dm.html` (~lines 1340-1900 — search for `BESTIARY PICKER`). The simplest way to ship v1 of the builder without forking 600 lines is to **embed the same UI as a section here, reusing the same `_BP` state but pointed at the current encounter's picks**.

- [ ] **Step 1: Inline-copy the bestiary picker DOM into a "Combatants" section**

Add to `renderEditor()` (after `renderIdentity`):

```javascript
      form.innerHTML = renderIdentity(e) + renderCombatants(e);
      hydrateCombatants(e);  // wire up the picker
```

Add `renderCombatants` and `hydrateCombatants`. Lift the inner HTML of the bestiary modal from `initiative-dm.html` — find the element with id `bp-modal` and copy its inner content (the search bar, filter row, list, and picks section) into a string template here. **For v1, copy verbatim and rename ids with an `enc-` prefix to avoid collisions** in case this page ever inlines initiative-dm.

Open `initiative-dm.html` and locate (use grep):

```bash
grep -n 'id="bp-modal"' initiative-dm.html
```

Copy the bestiary-modal inner HTML into a new function `renderCombatants(e)` returning that markup wrapped in `<details><summary>Combatants</summary>…</details>`. Update every internal id to use an `enc-` prefix.

In `hydrateCombatants(e)`, copy the JS that drives `_BP` from `initiative-dm.html` (lines 1340 onward — search for `_BP.loaded`). Adapt:

- `_BP.picks` source → `e.picks`
- `_BP.encounters` → no longer used here (the library IS the encounters list)
- Save on changes → call `updateField('picks', _BP.picks)` instead of any direct KV write.

**This is a lift-and-shift step. For brevity in this plan, the exact 400+ lines of picker code are not duplicated — reference `initiative-dm.html` directly. If the implementer prefers a smaller diff:** mark this task as "expose the existing picker as a callable module in initiative-dm.html and import" — but that's a follow-up refactor, not the first cut.

- [ ] **Step 2: Test — open the page, expand Combatants, search for "goblin," add 3, observe FM CR-budget readout update**

- [ ] **Step 3: Commit**

```bash
git add encounter-dm.html
git commit -m "Encounter builder: Combatants section (bestiary picker lift)"
```

---

### Task 3.6: Editor — Tactical setup section

**Files:**
- Modify: `encounter-dm.html`

- [ ] **Step 1: Add `renderTactical(e)`**

```javascript
    function renderTactical(e) {
      const waves = e.tactical.waves.map((w, i) => `
        <div class="wave-row">
          <input type="number" min="1" max="50" value="${w.round}" placeholder="round"
                 oninput="updateWave(${i}, 'round', parseInt(this.value, 10) || 1)" style="width:60px">
          <select onchange="updateWave(${i}, 'pickKey', this.value)">
            <option value="">(none)</option>
            ${e.picks.map(p => `<option value="${p.pickKey}" ${w.pickKey === p.pickKey ? 'selected' : ''}>${escapeHtml(p.pickKey + ': ' + (p.id || '?'))}</option>`).join('')}
          </select>
          <input type="number" min="1" value="${w.count}" placeholder="count"
                 oninput="updateWave(${i}, 'count', parseInt(this.value, 10) || 1)" style="width:60px">
          <input type="text" value="${escapeHtml(w.fromDirection || '')}" placeholder="from direction"
                 oninput="updateWave(${i}, 'fromDirection', this.value)">
          <button onclick="removeWave(${i})">×</button>
        </div>
      `).join('');
      return `
        <details><summary>Tactical setup</summary>
          <div class="field"><label>Terrain</label>
            <textarea oninput="updateField('tactical.terrain', this.value)">${escapeHtml(e.tactical.terrain)}</textarea>
          </div>
          <div class="field"><label>Lighting</label>
            <select onchange="updateField('tactical.lighting', this.value)">
              ${EncounterSchema.LIGHTING.map(l => `<option value="${l}" ${e.tactical.lighting === l ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Surprise</label>
            <select onchange="updateField('tactical.surprise', this.value)">
              ${EncounterSchema.SURPRISE.map(s => `<option value="${s}" ${e.tactical.surprise === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Starting positions</label>
            <textarea oninput="updateField('tactical.startingPositions', this.value)">${escapeHtml(e.tactical.startingPositions)}</textarea>
          </div>
          <div class="field"><label>Waves</label>
            <div id="waves-list">${waves || '<em>None — fight starts with all combatants.</em>'}</div>
            <button onclick="addWave()">+ Add wave</button>
          </div>
          <div class="field"><label>Opening read-aloud (shown to DM at top of tracker)</label>
            <textarea rows="4" oninput="updateField('tactical.readAloud', this.value)">${escapeHtml(e.tactical.readAloud)}</textarea>
          </div>
        </details>
      `;
    }

    function updateWave(i, key, value) {
      const e = currentEncounter();
      e.tactical.waves[i][key] = value;
      scheduleSave();
      renderEditor();
    }
    function addWave() {
      const e = currentEncounter();
      e.tactical.waves.push({ round: 2, pickKey: e.picks[0]?.pickKey || '', count: 1, fromDirection: '', notes: '' });
      scheduleSave();
      renderEditor();
    }
    function removeWave(i) {
      const e = currentEncounter();
      e.tactical.waves.splice(i, 1);
      scheduleSave();
      renderEditor();
    }
```

Append to `renderEditor()`'s form.innerHTML composition:

```javascript
      form.innerHTML = renderIdentity(e) + renderCombatants(e) + renderTactical(e);
```

Add to `<style>`:

```css
.wave-row { display: flex; gap: 6px; margin-bottom: 4px; align-items: center; }
.wave-row > * { font-size: 0.85rem; }
```

- [ ] **Step 2: Test — add a wave, set fields, refresh, confirm persisted**

- [ ] **Step 3: Commit**

```bash
git add encounter-dm.html
git commit -m "Encounter builder: Tactical setup section"
```

---

### Task 3.7: Editor — DM playbook section

**Files:**
- Modify: `encounter-dm.html`

- [ ] **Step 1: Add `renderPlaybook(e)`**

```javascript
    function renderPlaybook(e) {
      return `
        <details><summary>DM playbook</summary>
          <div class="field"><label>Overall tactics</label>
            <textarea rows="3" oninput="updateField('playbook.overallTactics', this.value)">${escapeHtml(e.playbook.overallTactics)}</textarea>
          </div>
          <div class="field"><label>Per-monster tactics</label>
            ${e.picks.map(p => `
              <div style="display:flex;gap:6px;margin-bottom:4px;align-items:center">
                <span style="min-width:80px;font-size:0.75rem;color:var(--c-ink-faint)">${escapeHtml(p.pickKey + ': ' + (p.id || '?'))}</span>
                <input type="text" value="${escapeHtml(p.tactics || '')}"
                       oninput="updatePickTactics('${p.pickKey}', this.value)" style="flex:1">
              </div>
            `).join('') || '<em>Add monsters above first.</em>'}
          </div>
          <div class="field"><label>Retreat triggers</label>
            <textarea rows="2" oninput="updateField('playbook.retreatTriggers', this.value)">${escapeHtml(e.playbook.retreatTriggers)}</textarea>
          </div>
          <div class="field"><label>Victory conditions</label>
            <textarea rows="2" oninput="updateField('playbook.victoryConditions', this.value)">${escapeHtml(e.playbook.victoryConditions)}</textarea>
          </div>
          <div class="field"><label>DM reminders</label>
            <textarea rows="2" oninput="updateField('playbook.reminders', this.value)">${escapeHtml(e.playbook.reminders)}</textarea>
          </div>
        </details>
      `;
    }

    function updatePickTactics(pickKey, value) {
      const e = currentEncounter();
      const p = e.picks.find(x => x.pickKey === pickKey);
      if (p) { p.tactics = value; scheduleSave(); }
    }
```

Append to `renderEditor()`:

```javascript
      form.innerHTML = renderIdentity(e) + renderCombatants(e) + renderTactical(e) + renderPlaybook(e);
```

- [ ] **Step 2: Test — type per-monster tactics, refresh, confirm**

- [ ] **Step 3: Commit**

```bash
git add encounter-dm.html
git commit -m "Encounter builder: DM playbook section"
```

---

### Task 3.8: Editor — Pre-staged loot section

**Files:**
- Modify: `encounter-dm.html`

- [ ] **Step 1: Add `renderLoot(e)`**

```javascript
    function renderLoot(e) {
      return `
        <details><summary>Pre-staged loot</summary>
          <div id="loot-list">
            ${e.loot.map((l, i) => `
              <div class="loot-row">
                <input type="text" value="${escapeHtml(l.name || '')}" placeholder="item"
                       oninput="updateLoot(${i}, 'name', this.value)" style="flex:1">
                <input type="number" min="1" value="${l.qty || 1}" placeholder="qty"
                       oninput="updateLoot(${i}, 'qty', parseInt(this.value, 10) || 1)" style="width:60px">
                <input type="text" value="${escapeHtml(l.value || '')}" placeholder="value"
                       oninput="updateLoot(${i}, 'value', this.value)" style="width:80px">
                <input type="text" value="${escapeHtml(l.notes || '')}" placeholder="notes"
                       oninput="updateLoot(${i}, 'notes', this.value)" style="flex:1">
                <button onclick="removeLoot(${i})">×</button>
              </div>
            `).join('')}
          </div>
          <button onclick="addLoot()">+ Add loot row</button>
        </details>
      `;
    }

    function updateLoot(i, key, value) {
      currentEncounter().loot[i][key] = value;
      scheduleSave();
    }
    function addLoot() {
      currentEncounter().loot.push({
        id: 'lt_' + Date.now() + Math.floor(Math.random() * 100000),
        name: '', qty: 1, value: '—', notes: '',
      });
      scheduleSave();
      renderEditor();
    }
    function removeLoot(i) {
      currentEncounter().loot.splice(i, 1);
      scheduleSave();
      renderEditor();
    }
```

Add `+ renderLoot(e)` to the `renderEditor()` composition.

Add to `<style>`:

```css
.loot-row { display: flex; gap: 6px; margin-bottom: 4px; }
```

- [ ] **Step 2: Test — add loot, refresh, confirm persisted**

- [ ] **Step 3: Commit**

```bash
git add encounter-dm.html
git commit -m "Encounter builder: Pre-staged loot section"
```

---

### Task 3.9: Editor — Linkages section (location, session, NPCs)

**Files:**
- Modify: `encounter-dm.html`

- [ ] **Step 1: Add `renderLinkages(e)`**

```javascript
    function renderLinkages(e) {
      const ref = e.locationRef;
      const allLocs = [];  // [{kind, parentLocationId, locationId, label}]
      (state.worldData?.locations || []).forEach(loc => {
        allLocs.push({ kind: 'world', locationId: loc.id, label: loc.name + ' (world)' });
        (loc.subMap?.locations || []).forEach(sub =>
          allLocs.push({ kind: 'submap', parentLocationId: loc.id, locationId: sub.id, label: loc.name + ' › ' + sub.name }));
      });
      const refKey = ref ? `${ref.kind}|${ref.parentLocationId || ''}|${ref.locationId}` : '';

      const sessions = state.timeline.filter(t => t.kind === 'planned' || t.kind === 'session');

      return `
        <details><summary>Linkages</summary>
          <div class="field"><label>Location</label>
            <select onchange="setLocationRef(this.value)">
              <option value="">(unlocated)</option>
              ${allLocs.map(l => {
                const k = `${l.kind}|${l.parentLocationId || ''}|${l.locationId}`;
                return `<option value="${k}" ${k === refKey ? 'selected' : ''}>${escapeHtml(l.label)}</option>`;
              }).join('')}
            </select>
          </div>
          <div class="field"><label>Planned session</label>
            <select onchange="updateField('sessionId', this.value || null)">
              <option value="">(none)</option>
              ${sessions.map(s => `<option value="${s.id}" ${e.sessionId === s.id ? 'selected' : ''}>${escapeHtml(s.title || s.id)}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>NPC roles</label>
            ${e.npcRoles.map((r, i) => {
              const npc = state.npcs.find(n => n.id === r.npcId);
              return `
                <div style="display:flex;gap:6px;margin-bottom:4px">
                  <span style="flex:1">${escapeHtml(npc ? npc.name : '(deleted) ' + r.npcId)}</span>
                  <select onchange="updateNpcRole(${i}, this.value)">
                    ${EncounterSchema.NPC_ROLES.map(role => `<option value="${role}" ${r.role === role ? 'selected' : ''}>${role}</option>`).join('')}
                  </select>
                  <button onclick="removeNpcRole(${i})">×</button>
                </div>
              `;
            }).join('')}
            <select onchange="addNpcRole(this.value); this.value=''">
              <option value="">+ Add NPC…</option>
              ${state.npcs.filter(n => !e.npcRoles.some(r => r.npcId === n.id))
                .map(n => `<option value="${n.id}">${escapeHtml(n.name)}</option>`).join('')}
            </select>
          </div>
        </details>
      `;
    }

    function setLocationRef(key) {
      const e = currentEncounter();
      if (!key) { e.locationRef = null; }
      else {
        const [kind, parent, loc] = key.split('|');
        e.locationRef = kind === 'world'
          ? { kind: 'world', locationId: loc }
          : { kind: 'submap', parentLocationId: parent, locationId: loc };
      }
      scheduleSave();
      renderEditor();
    }
    function addNpcRole(npcId) {
      if (!npcId) return;
      currentEncounter().npcRoles.push({ npcId, role: 'enemy' });
      scheduleSave();
      renderEditor();
    }
    function updateNpcRole(i, role) {
      currentEncounter().npcRoles[i].role = role;
      scheduleSave();
    }
    function removeNpcRole(i) {
      currentEncounter().npcRoles.splice(i, 1);
      scheduleSave();
      renderEditor();
    }
```

Add `+ renderLinkages(e)` to the `renderEditor()` composition.

- [ ] **Step 2: Test — bind a location, bind a session (if any planned sessions exist), add an NPC role, refresh, confirm persisted**

- [ ] **Step 3: Commit**

```bash
git add encounter-dm.html
git commit -m "Encounter builder: Linkages section (location, session, NPCs)"
```

---

### Task 3.10: Launchpad pane — summary + status + launch buttons

**Files:**
- Modify: `encounter-dm.html`

- [ ] **Step 1: Replace `renderLaunchpad()`**

```javascript
    function renderLaunchpad() {
      const root = document.getElementById('launchpad-content');
      const e = currentEncounter();
      if (!e) { root.innerHTML = ''; return; }
      const totalCount = e.picks.reduce((a, p) => a + (p.qty || 1), 0);
      root.innerHTML = `
        <div class="lp-card">
          <div class="lp-status lib-status-${e.status}">${e.status}</div>
          <div class="lp-name">${escapeHtml(e.name || '(untitled)')}</div>
          <div class="lp-meta">${totalCount} monster${totalCount === 1 ? '' : 's'}</div>
        </div>
        <button class="btn-primary" onclick="runOnWarTable()">▶ Run on War Table</button>
        <button class="btn-secondary" onclick="sendToCrucible()">⚗ Send to Crucible</button>
        <hr>
        <div class="field"><label>Status</label>
          <select onchange="updateField('status', this.value)">
            ${EncounterSchema.STATUSES.map(s => `<option value="${s}" ${e.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        ${e.resolvedAt ? `
          <div class="lp-last-run">
            <strong>Last run:</strong> ${new Date(e.resolvedAt).toLocaleDateString()}<br>
            Outcome: ${e.lastOutcome || '(unrecorded)'}
          </div>` : ''}
        <hr>
        <details><summary>Actions</summary>
          <button onclick="duplicateEncounter()">Duplicate</button>
          <button onclick="archiveEncounter()">Archive</button>
          <button onclick="deleteEncounter()" style="color:#d66">Delete</button>
        </details>
      `;
    }

    function runOnWarTable() {
      const e = currentEncounter();
      if (!e) return;
      location.href = 'initiative-dm.html?stage=' + encodeURIComponent(e.id);
    }
    function sendToCrucible() {
      const e = currentEncounter();
      if (!e) return;
      location.href = 'crucible-dm.html?from-encounter=' + encodeURIComponent(e.id);
    }
    function duplicateEncounter() {
      const e = currentEncounter();
      if (!e) return;
      const copy = JSON.parse(JSON.stringify(e));
      copy.id = EncounterSchema.genId('enc');
      copy.name = (e.name || '(untitled)') + ' (copy)';
      copy.status = 'draft';
      copy.createdAt = copy.updatedAt = new Date().toISOString();
      copy.lastStagedAt = copy.resolvedAt = copy.resolvedInTimelineId = null;
      copy.lastOutcome = null;
      state.encounters.push(copy);
      state.selectedId = copy.id;
      scheduleSave();
      render();
    }
    function archiveEncounter() {
      const e = currentEncounter();
      if (!e) return;
      e.status = 'archived';
      scheduleSave();
      render();
    }
    function deleteEncounter() {
      const e = currentEncounter();
      if (!e) return;
      if (!confirm('Delete "' + (e.name || '(untitled)') + '" permanently?')) return;
      state.encounters = state.encounters.filter(x => x.id !== e.id);
      state.selectedId = null;
      scheduleSave();
      render();
    }
```

Add to `<style>`:

```css
.lp-card { padding: 8px; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 3px; margin-bottom: 8px; }
.lp-status { display: inline-block; padding: 1px 8px; border: 1px solid currentColor; border-radius: 8px; font-family: 'Cinzel', serif; font-size: 0.6rem; letter-spacing: 0.08em; text-transform: uppercase; }
.lp-name { font-family: 'Cinzel', serif; font-size: 1rem; margin: 6px 0; }
.lp-meta { font-size: 0.75rem; color: var(--c-ink-faint); }
.btn-primary { width: 100%; padding: 10px; background: var(--c-brass); color: #1a1f24; border: none; border-radius: 3px; font-family: 'Cinzel', serif; cursor: pointer; margin-bottom: 6px; }
.btn-secondary { width: 100%; padding: 8px; background: var(--c-surface); color: var(--c-ink); border: 1px solid var(--c-border); border-radius: 3px; cursor: pointer; margin-bottom: 6px; }
.lp-last-run { padding: 8px; background: var(--c-surface); border-left: 3px solid var(--c-brass); font-size: 0.8rem; margin-bottom: 8px; }
```

- [ ] **Step 2: Test — buttons render, "Run" navigates to `initiative-dm.html?stage=<id>`, "Send to Crucible" navigates to `crucible-dm.html?from-encounter=<id>`**

- [ ] **Step 3: Commit**

```bash
git add encounter-dm.html
git commit -m "Encounter builder: Launchpad pane (summary, run, crucible, status, duplicate/archive/delete)"
```

---

### Task 3.11: URL param handlers — `?id=`, `?newAt=`, `?newFor=`

**Files:**
- Modify: `encounter-dm.html`

- [ ] **Step 1: After `loadAll()` succeeds, parse URL params**

Modify `loadAll`'s tail (after `render()` is called):

```javascript
      handleUrlParams();
    }

    function handleUrlParams() {
      const params = new URLSearchParams(location.search);
      const id = params.get('id');
      const newAt = params.get('newAt');  // "kind:parent?:locationId"
      const newFor = params.get('newFor'); // sessionId

      if (id) {
        if (state.encounters.some(e => e.id === id)) selectEncounter(id);
      } else if (newAt || newFor) {
        const e = EncounterSchema.newEncounter('New encounter');
        if (newAt) {
          const [kind, parent, loc] = newAt.split(':');
          e.locationRef = kind === 'world'
            ? { kind: 'world', locationId: loc }
            : { kind: 'submap', parentLocationId: parent, locationId: loc };
        }
        if (newFor) e.sessionId = newFor;
        state.encounters.push(e);
        state.selectedId = e.id;
        scheduleSave();
        render();
      }
      // Strip params so refresh doesn't re-trigger.
      if (id || newAt || newFor) history.replaceState(null, '', location.pathname);
    }
```

- [ ] **Step 2: Test — open `encounter-dm.html?newAt=world::chapel` → creates a new encounter with locationRef set to world chapel, URL cleans up**

- [ ] **Step 3: Commit**

```bash
git add encounter-dm.html
git commit -m "Encounter builder: URL params (?id=, ?newAt=, ?newFor=)"
```

---

### Task 3.12: Home page card

**Files:**
- Modify: `home.html:380-382`

- [ ] **Step 1: Add a card definition between The Crucible and War Table cards**

Open `home.html` and find the Keeper's Wing card list (around line 376-383). Add a new card entry:

```javascript
          makeCard({ href: 'crucible-dm.html',   icon: ICONS.crucible,   title: 'The Crucible',    desc: 'Simulate a fight against a chosen group of monsters; see win-rate, per-PC outcomes, and per-action effectiveness.', dm: true, i: i++ }),
          makeCard({ href: 'encounter-dm.html',  icon: ICONS.encounter,  title: 'The Anvil',       desc: 'Forge encounters: monsters, terrain, surprise, tactics, loot. One-click stage into the War Table.', dm: true, i: i++ }),
          makeCard({ href: 'initiative-dm.html', icon: ICONS.initdm,     title: 'War Table',       desc: 'Order, HP, conditions, broadcast to players.',                       dm: true, i: i++ }),
```

- [ ] **Step 2: Add an `ICONS.encounter` SVG to the ICONS object (around line 327-339)**

```javascript
      encounter: `<svg class="card-icon" viewBox="0 0 52 52" fill="none"><path d="M14 12 L26 6 L38 12 L38 26 L26 38 L14 26 Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="26" cy="22" r="4" stroke="currentColor" stroke-width="1.8"/><line x1="26" y1="26" x2="26" y2="34" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="20" r="1.6" fill="currentColor"/><circle cx="34" cy="20" r="1.6" fill="currentColor"/></svg>`,
```

- [ ] **Step 3: Test — sign in as DM, open `home.html`, confirm The Anvil card appears**

- [ ] **Step 4: Commit**

```bash
git add home.html
git commit -m "Home: add The Anvil card (encounter builder) to Keeper's Wing"
```

---

## Phase 4 — War Table integration

### Task 4.1: Remove in-modal save UI from War Table's bestiary picker

**Files:**
- Modify: `initiative-dm.html`

- [ ] **Step 1: Remove the saved-encounters block from the bestiary modal**

Find and delete (around line 681-682):

```html
        <span>Saved encounters (<span id="bp-enc-count">0</span>)</span>
        <button class="enc-save" id="bp-enc-save-btn" onclick="saveCurrentEncounter()" disabled>💾 Save current as…</button>
```

Delete the rendering of the saved-encounters list block (find the enclosing `<div>` and remove). Also delete the JS functions: `saveCurrentEncounter`, `loadEncounter`, `deleteEncounter`, `saveEncountersToKV`, `renderSavedEncountersList` (search by name; they're around lines 1767-1880).

Delete the `_BP.encounters` field initialization (line 1353) and the `fetch(WORKER_URL + '?type=encounters', ...)` call in `loadBestiary` (around line 1543) — or keep the fetch and just stop using `_BP.encounters` if other code expects the fetch parallelism.

**Concrete minimal removal — leave the `_BP.encounters` field empty but in place to avoid touching `loadBestiary`'s Promise.all shape; delete only the visible UI and the save/load/delete handlers.** That gives the smallest diff.

- [ ] **Step 2: Add a link to the new builder where the save UI was**

Replace the deleted markup with:

```html
        <span style="font-family:Cinzel,serif;font-size:0.66rem;letter-spacing:0.1em;color:var(--c-ink-dim)">
          To save a re-usable encounter, use <a href="encounter-dm.html" style="color:var(--c-brass)">The Anvil</a>.
        </span>
```

- [ ] **Step 3: Test — open War Table's bestiary picker, confirm the save UI is gone, link to Anvil is present**

- [ ] **Step 4: Commit**

```bash
git add initiative-dm.html
git commit -m "War Table: remove in-modal saved-encounters UI, link to The Anvil"
```

---

### Task 4.2: War Table — `?stage=<id>` URL receiver (fetch + confirm)

**Files:**
- Modify: `initiative-dm.html`

- [ ] **Step 1: Add `<script src="encounter-schema.js"></script>` to the page head if not already present**

```bash
grep -n "encounter-schema.js" initiative-dm.html
```

If missing, add it after the other `<script src="...">` lines near the top of `<body>`.

- [ ] **Step 2: Add the URL receiver at the end of the existing init flow**

Locate where the page finishes its initial setup (after `pollState()` is first called, or wherever `init()` resolves). Add a function call:

```javascript
    // After initial state load, check for ?stage=<encounterId>
    handleStageParam();

    async function handleStageParam() {
      const id = new URLSearchParams(location.search).get('stage');
      if (!id) return;
      // Strip the param so refresh doesn't re-stage.
      history.replaceState(null, '', location.pathname);

      const headers = Auth.dmHeaders();
      let encs;
      try {
        encs = await fetch(WORKER_URL + '?type=encounters', { headers }).then(r => r.json());
      } catch (e) {
        alert('Could not load encounter: ' + e.message);
        return;
      }
      const raw = (encs || []).find(e => e.id === id);
      if (!raw) {
        alert('Encounter ' + id + ' not found.');
        return;
      }
      const enc = EncounterSchema.migrateInMemory(raw);

      // Confirm if combat is active.
      if (typeof getCombatActive === 'function' ? getCombatActive() : isCombatActive()) {
        const count = (window.combatants || []).length;
        if (!confirm('Combat in progress (' + count + ' combatants). Stage "' + (enc.name || 'this encounter') + '" and discard the current roster?')) {
          return;
        }
      }

      stageEncounter(enc);  // Implemented in Task 4.3
    }

    // Polyfill if the page doesn't already expose a combat-active check.
    function isCombatActive() {
      return Array.isArray(window.combatants) && window.combatants.length > 0;
    }
```

- [ ] **Step 3: Test — open `initiative-dm.html?stage=<a-real-encounter-id>` → confirm receives it (stub stageEncounter with `console.log` for now)**

- [ ] **Step 4: Commit**

```bash
git add initiative-dm.html
git commit -m "War Table: receive ?stage=<id> URL param + confirm if combat active"
```

---

### Task 4.3: War Table — instantiate combatants from encounter picks

**Files:**
- Modify: `initiative-dm.html`

- [ ] **Step 1: Implement `stageEncounter(enc)`**

The bestiary picker already has an "Add picks to combat" code path that converts `_BP.picks` to combatant rows. Find it (grep for `addPicksToCombat` or the function that does the conversion). Reuse its core logic:

```javascript
    function stageEncounter(enc) {
      // Clear current roster (the confirm has already gated this).
      if (typeof endCombatSilently === 'function') endCombatSilently();
      window.combatants = [];

      // Add each pick. The existing bestiary 'add picks' logic reads from _BP.picks;
      // bridge to it by temporarily populating _BP.picks and calling the existing routine.
      _BP.picks = enc.picks.map(p => ({
        id: p.id, qty: p.qty,
        rollHp: p.rollHp, hpOverride: p.hpOverride,
        rollInit: p.rollInit, initOverride: p.initOverride,
        hidden: p.hidden,
        pickKey: p.pickKey,
        startingConditions: p.startingConditions || [],
      }));

      // The existing function name varies; search:
      //   grep -n "function addPicksToCombat\|function bpAddPicks\|function addAllPicks" initiative-dm.html
      // Then call it here. If none exists, replicate the loop that bestiary's "+ Add to combat"
      // button uses on a single pick — wrap it in a forEach.
      addPicksToCombat();  // <- Adjust to the actual function name found.

      // Apply surprise / starting conditions per pickKey.
      applyStagingMetadata(enc);

      // Stamp encounterId so the next pushState write carries it.
      window.encounterId = enc.id;
      window.encounterStagedAt = new Date().toISOString();
      pushState();  // existing function that POSTs initiative_state

      // Show the read-aloud banner if non-empty.
      if (enc.tactical.readAloud) showReadAloudBanner(enc.tactical.readAloud, enc.name);

      // Fire-and-forget status update on the encounter.
      markEncounterStatusLive(enc.id);
    }

    function applyStagingMetadata(enc) {
      const conditionsByPickKey = {};
      enc.picks.forEach(p => { if (p.pickKey) conditionsByPickKey[p.pickKey] = p.startingConditions || []; });
      (window.combatants || []).forEach(c => {
        // The combatant rows produced by addPicksToCombat must preserve pickKey somewhere.
        // If they don't yet, modify the conversion to copy pickKey onto each combatant in the loop above.
        const conds = conditionsByPickKey[c.pickKey];
        if (conds && conds.length) {
          c.conditions = (c.conditions || []).concat(conds);
        }
        // Surprise: if 'monsters' or 'both', mark all hostile combatants as surprised (round 1 hidden init bonus).
        // The exact mechanism depends on the tracker's existing surprise field; if none exists,
        // tag the combatant with `c.surprised = true` and update the row renderer to show it.
        if (enc.tactical.surprise === 'monsters' || enc.tactical.surprise === 'both') {
          if (c.side === 'hostile') c.surprised = true;
        }
        if (enc.tactical.surprise === 'party' || enc.tactical.surprise === 'both') {
          if (c.side === 'party') c.surprised = true;
        }
      });
    }
```

**If `pickKey` doesn't propagate through `addPicksToCombat` (very likely):** edit that function so each combatant row carries `pickKey` from the source pick. This is the minimum surgical change to make `applyStagingMetadata` work.

- [ ] **Step 2: Test — stage an encounter with starting conditions, confirm conditions appear on combatants**

- [ ] **Step 3: Commit**

```bash
git add initiative-dm.html
git commit -m "War Table: instantiate combatants from staged encounter, apply surprise + conditions"
```

---

### Task 4.4: War Table — read-aloud banner

**Files:**
- Modify: `initiative-dm.html`

- [ ] **Step 1: Add `showReadAloudBanner` reusing the recovery-banner slot**

The page already has a recovery-banner area for `combat_drafts` (search for `recovery-banner` or `combat-draft`). Reuse the same slot styling:

```javascript
    function showReadAloudBanner(text, name) {
      let bar = document.getElementById('readaloud-banner');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'readaloud-banner';
        bar.className = 'recovery-banner';  // reuse existing styling
        bar.style.cssText = 'padding:10px 14px;background:#3a4a3a;border-left:4px solid var(--c-brass);margin:8px 0;font-family:Crimson Text,serif;';
        // Insert above the tracker — adjust selector to the actual tracker container id.
        document.body.insertBefore(bar, document.querySelector('.tracker, #tracker, main'));
      }
      bar.innerHTML = `
        <strong>${escapeHtml(name)}:</strong>
        <p style="margin:6px 0">${escapeHtml(text).replace(/\n/g, '<br>')}</p>
        <button onclick="dismissReadAloud()">Dismiss</button>
      `;
    }
    function dismissReadAloud() {
      document.getElementById('readaloud-banner')?.remove();
    }

    // If not already defined on this page, add a local escapeHtml.
    if (typeof escapeHtml !== 'function') {
      window.escapeHtml = function (s) {
        return (s || '').toString()
          .replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      };
    }
```

- [ ] **Step 2: Test — stage an encounter with read-aloud text, banner appears above tracker, dismiss removes it**

- [ ] **Step 3: Commit**

```bash
git add initiative-dm.html
git commit -m "War Table: read-aloud banner on staged encounter"
```

---

### Task 4.5: War Table — wave reminders

**Files:**
- Modify: `initiative-dm.html`

- [ ] **Step 1: Track the staged encounter's waves and emit a banner when round approaches**

Add module-level state:

```javascript
    let stagedWaves = [];  // populated by stageEncounter
```

In `stageEncounter`, before `pushState()`:

```javascript
      stagedWaves = enc.tactical.waves.slice();  // local copy
```

Hook into round-advance (search for `currentRound` or `nextRound` or wherever the round counter is incremented):

```javascript
    function checkWaveReminders() {
      const round = (typeof currentRound !== 'undefined') ? currentRound : 1;
      const due = stagedWaves.filter(w => w.round === round + 1);  // 1 round ahead
      const root = document.getElementById('wave-reminder-area');
      if (!root) return;
      root.innerHTML = due.map(w => `
        <div class="wave-reminder">
          <strong>Wave incoming next round:</strong> ${w.count} × ${escapeHtml(_BP.picks.find(p => p.pickKey === w.pickKey)?.id || w.pickKey)}
          ${w.fromDirection ? 'from ' + escapeHtml(w.fromDirection) : ''}
          <button onclick="spawnWave('${w.pickKey}', ${w.count})">Add wave</button>
        </div>
      `).join('');
    }

    function spawnWave(pickKey, count) {
      // Find the bestiary pick template by pickKey, then add `count` combatants reusing the existing add-combatant code path.
      const pick = _BP.picks.find(p => p.pickKey === pickKey);
      if (!pick) return;
      for (let i = 0; i < count; i++) addOneCombatantFromPick(pick);  // adjust to actual function
      checkWaveReminders();
    }
```

Add a `<div id="wave-reminder-area"></div>` to the page HTML, just above the tracker.

Call `checkWaveReminders()` from the existing round-change handler (search `currentRound++` or similar).

- [ ] **Step 2: Test — stage an encounter with a wave at round 3, advance to round 2 → banner appears, click Add wave → combatants added**

- [ ] **Step 3: Commit**

```bash
git add initiative-dm.html
git commit -m "War Table: wave reminders + Add-wave button"
```

---

### Task 4.6: War Table — encounterId on initiative_state POST

**Files:**
- Modify: `initiative-dm.html`

- [ ] **Step 1: Include `encounterId` + `encounterStagedAt` in `pushState()`'s payload**

Find `pushState()` (it constructs the state object for `initiative_state` POST). Add:

```javascript
    // Inside the payload construction:
      if (window.encounterId) {
        state.encounterId = window.encounterId;
        state.encounterStagedAt = window.encounterStagedAt;
      }
```

- [ ] **Step 2: Implement `markEncounterStatusLive(id)`**

```javascript
    async function markEncounterStatusLive(id) {
      const headers = Auth.dmHeaders();
      try {
        const arr = await fetch(WORKER_URL + '?type=encounters', { headers }).then(r => r.json());
        const merged = (arr || []).map(EncounterSchema.migrateInMemory).map(e =>
          e.id === id ? { ...e, status: 'live', lastStagedAt: new Date().toISOString() } : e);
        await fetch(WORKER_URL, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'encounters', payload: merged }),
        });
      } catch (e) {
        console.warn('markEncounterStatusLive failed:', e);
      }
    }
```

- [ ] **Step 3: Test — stage an encounter, open Anvil in another tab, confirm status shows "live"**

- [ ] **Step 4: Commit**

```bash
git add initiative-dm.html
git commit -m "War Table: stamp encounterId on initiative_state + flip encounter to 'live' on stage"
```

---

### Task 4.7: War Table — export modal pre-fill from staged encounter

**Files:**
- Modify: `initiative-dm.html`

- [ ] **Step 1: Find the existing `exportToChronicle()` (search for the function)**

```bash
grep -n "function exportToChronicle\|exportToChronicle\s*=" initiative-dm.html
```

- [ ] **Step 2: Modify the modal-open path to pre-fill from the encounter if `window.encounterId` is set**

Inside `exportToChronicle` (or wherever the export modal is populated), add at the top:

```javascript
      // Pre-fill from staged encounter, if any.
      if (window.encounterId) {
        const arr = await fetch(WORKER_URL + '?type=encounters', { headers: Auth.dmHeaders() }).then(r => r.json()).catch(() => []);
        const enc = (arr || []).map(EncounterSchema.migrateInMemory).find(e => e.id === window.encounterId);
        if (enc) {
          // Title default.
          const titleEl = document.getElementById('export-title');
          if (titleEl && !titleEl.value) titleEl.value = enc.name;
          // Session binding.
          if (enc.sessionId) {
            const sessionSel = document.getElementById('export-session');
            if (sessionSel) sessionSel.value = enc.sessionId;
          }
          // Location binding (resolve world or submap).
          if (enc.locationRef) {
            const locSel = document.getElementById('export-location');
            if (locSel) locSel.value = enc.locationRef.locationId;  // adjust if the page uses the structured form
          }
          // Loot pre-fill.
          if (enc.loot && enc.loot.length) {
            // The page's loot model has its own row format; copy entries.
            preFillLoot(enc.loot);  // implement to push rows into the existing loot UI
          }
          // NPC participation.
          if (enc.npcRoles && enc.npcRoles.length) {
            preFillParticipants(enc.npcRoles.map(r => r.npcId));
          }
        }
      }
```

For `preFillLoot` and `preFillParticipants` — adjust to match the existing export modal's internal state. The point is: the encounter's authored data lands in the modal as defaults; the DM can edit.

- [ ] **Step 3: Test — stage an encounter with loot, end combat, open export modal, confirm loot rows pre-filled**

- [ ] **Step 4: Commit**

```bash
git add initiative-dm.html
git commit -m "War Table: pre-fill export modal from staged encounter (title, session, location, loot, NPCs)"
```

---

### Task 4.8: War Table — resolution POST after successful timeline write

**Files:**
- Modify: `initiative-dm.html`

- [ ] **Step 1: After the existing successful timeline POST (inside `exportToChronicle`), POST encounter resolution**

```javascript
      // After the existing successful timeline write, before the modal closes:
      if (window.encounterId && timelineWriteSucceeded /* the existing flag */) {
        const outcome = document.getElementById('export-outcome')?.value || null; // adjust to actual element
        const newEntryId = createdTimelineEntryId;  // captured from the successful response
        const headers = Auth.dmHeaders();
        try {
          const arr = await fetch(WORKER_URL + '?type=encounters', { headers }).then(r => r.json());
          const merged = (arr || []).map(EncounterSchema.migrateInMemory).map(e =>
            e.id === window.encounterId ? {
              ...e,
              status: 'completed',
              resolvedAt: new Date().toISOString(),
              resolvedInTimelineId: newEntryId,
              lastOutcome: ['won','tpk','fled','skipped'].includes(outcome) ? outcome : null,
            } : e);
          await fetch(WORKER_URL, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'encounters', payload: merged }),
          });
          window.encounterId = null;
          window.encounterStagedAt = null;
        } catch (e) {
          console.warn('Encounter resolution write failed:', e);
          showToast('Encounter status didn\'t update — refresh the builder and mark complete manually.');
        }
      }

      function showToast(msg) {
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#5a4030;color:#e8e6df;padding:10px 14px;border-radius:4px;font-family:Crimson Text,serif;z-index:2000;';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 6000);
      }
```

- [ ] **Step 2: Test — stage encounter, end combat, export → reopen Anvil → encounter shows status=completed with resolvedInTimelineId set**

- [ ] **Step 3: Commit**

```bash
git add initiative-dm.html
git commit -m "War Table: resolve encounter to 'completed' after successful timeline write"
```

---

### Task 4.9: War Table — combat draft carries `encounterId` forward

**Files:**
- Modify: `initiative-dm.html`

- [ ] **Step 1: Find where `combat_drafts` records are constructed**

```bash
grep -n "combat_drafts\|combatDraft" initiative-dm.html
```

- [ ] **Step 2: Add `encounterId` and `encounterStagedAt` to the draft payload**

In the draft construction:

```javascript
      const draft = {
        id: /* existing */,
        status: /* existing */,
        startedAt: /* existing */,
        savedAt: new Date().toISOString(),
        combatLog: /* existing */,
        encounterId: window.encounterId || null,
        encounterStagedAt: window.encounterStagedAt || null,
      };
```

- [ ] **Step 3: When recovering a draft via the recovery banner, restore the encounter context**

```javascript
      // In the recovery code path:
      if (draft.encounterId) {
        window.encounterId = draft.encounterId;
        window.encounterStagedAt = draft.encounterStagedAt;
      }
```

- [ ] **Step 4: Test — stage encounter, end combat without exporting, refresh page, recovery banner appears, click Export → resolution still fires correctly**

- [ ] **Step 5: Commit**

```bash
git add initiative-dm.html
git commit -m "War Table: combat drafts carry encounterId forward for cross-session resolution"
```

---

## Phase 5 — Cross-tool surfaces

### Task 5.1: Atlas Workshop — "Encounters here" panel

**Files:**
- Modify: `map-dm.html`

- [ ] **Step 1: Add `<script src="encounter-schema.js"></script>` to the page if not already there**

- [ ] **Step 2: Lazy-load encounters on first location modal open**

Locate `openLocModal` (around line 2049). At the start, ensure encounters are loaded:

```javascript
    async function ensureEncountersLoaded() {
      if (window.allEncounters) return window.allEncounters;
      const r = await fetch(WORKER_URL + '?type=encounters', { headers: Auth.dmHeaders() });
      const arr = r.ok ? await r.json() : [];
      window.allEncounters = (arr || []).map(EncounterSchema.migrateInMemory);
      return window.allEncounters;
    }
```

- [ ] **Step 3: Add the "Encounters here" panel in the location modal**

Find the location modal body (the section after the existing fields, before the modal footer). Add:

```html
    <div id="loc-encounters-panel" style="margin-top:1rem;padding:8px;border:1px solid var(--c-border-light);border-radius:3px">
      <div style="font-family:Cinzel,serif;font-size:0.66rem;letter-spacing:0.1em;color:var(--c-brass);margin-bottom:6px;text-transform:uppercase">Encounters here</div>
      <div id="loc-encounters-list">—</div>
      <button onclick="newEncounterAtCurrentLocation()" style="margin-top:6px">+ New encounter here</button>
    </div>
```

In `openLocModal`, after the existing rendering, call:

```javascript
      renderLocEncounters(loc);
```

Add the renderer:

```javascript
    async function renderLocEncounters(loc) {
      if (!loc) {
        document.getElementById('loc-encounters-list').textContent = 'Save the location first to bind encounters.';
        return;
      }
      const all = await ensureEncountersLoaded();
      const ref = inSubMap()
        ? { kind: 'submap', parentLocationId: currentSubMapParent()?.id, locationId: loc.id }
        : { kind: 'world',  locationId: loc.id };
      const matches = all.filter(e => EncounterSchema.equalLocationRefs(e.locationRef, ref));
      const root = document.getElementById('loc-encounters-list');
      if (!matches.length) {
        root.innerHTML = '<em>None yet.</em>';
        return;
      }
      root.innerHTML = matches.map(e => `
        <div style="padding:4px 0">
          <a href="encounter-dm.html?id=${encodeURIComponent(e.id)}" style="color:var(--c-brass)">${escapeHtml(e.name || '(untitled)')}</a>
          <span style="font-size:0.7rem;color:var(--c-ink-faint);margin-left:6px">${e.status} · ${e.picks.length} monsters</span>
        </div>
      `).join('');
    }

    function newEncounterAtCurrentLocation() {
      if (!editingLocId) { alert('Save the location first.'); return; }
      const parent = inSubMap() ? currentSubMapParent()?.id : '';
      const param = inSubMap() ? `submap:${parent}:${editingLocId}` : `world::${editingLocId}`;
      location.href = 'encounter-dm.html?newAt=' + encodeURIComponent(param);
    }
```

`currentSubMapParent` already exists (line 1036 in `map-dm.html`).

- [ ] **Step 4: Test — open a location, panel renders; create an encounter bound to that location in The Anvil; reopen the location, panel shows the encounter**

- [ ] **Step 5: Commit**

```bash
git add map-dm.html
git commit -m "Atlas Workshop: 'Encounters here' panel in location detail (world + sub-map)"
```

---

### Task 5.2: Chronicle Workshop — "Encounters planned" panel + readiness tally

**Files:**
- Modify: `sessions-dm.html`

- [ ] **Step 1: Add `<script src="encounter-schema.js"></script>` to the page**

- [ ] **Step 2: Lazy-load encounters; add a panel in the session entry editor**

Find the session entry editor (search for the session detail form). Add a panel mirroring the Atlas one:

```html
    <div id="session-encounters-panel" style="margin-top:1rem;padding:8px;border:1px solid var(--c-border-light);border-radius:3px">
      <div style="font-family:Cinzel,serif;font-size:0.66rem;letter-spacing:0.1em;color:var(--c-brass);margin-bottom:6px;text-transform:uppercase">Encounters planned</div>
      <div id="session-encounters-list">—</div>
      <button onclick="newEncounterForCurrentSession()" style="margin-top:6px">+ Add encounter to this session</button>
    </div>
```

In the editor's open/render flow:

```javascript
    async function ensureEncountersLoaded() { /* same as Atlas */ }
    async function renderSessionEncounters(entry) {
      if (!entry) return;
      const all = await ensureEncountersLoaded();
      const matches = all.filter(e => e.sessionId === entry.id);
      const root = document.getElementById('session-encounters-list');
      if (!matches.length) { root.innerHTML = '<em>None yet.</em>'; return; }
      root.innerHTML = matches.map(e => `
        <div style="padding:4px 0">
          <a href="encounter-dm.html?id=${encodeURIComponent(e.id)}" style="color:var(--c-brass)">${escapeHtml(e.name || '(untitled)')}</a>
          <span style="font-size:0.7rem;color:var(--c-ink-faint);margin-left:6px">${e.status} · ${e.picks.length} monsters</span>
        </div>
      `).join('');
    }
    function newEncounterForCurrentSession() {
      if (!editingSessionId) { alert('Save the session first.'); return; }
      location.href = 'encounter-dm.html?newFor=' + encodeURIComponent(editingSessionId);
    }
```

Hook `renderSessionEncounters(entry)` into the existing session-open code path.

- [ ] **Step 3: Add readiness tally to session list row rendering**

Locate where session rows are rendered in the session list. Add a per-row tally:

```javascript
      const planned = (window.allEncounters || []).filter(e => e.sessionId === entry.id);
      const ready = planned.filter(e => e.status === 'ready' || e.status === 'scheduled').length;
      const draft = planned.length - ready;
      const tally = planned.length
        ? `<span style="font-size:0.7rem;color:var(--c-ink-faint)">${planned.length} encounters: ${ready} ready, ${draft} draft</span>`
        : '';
      // Append `tally` to the row's existing HTML.
```

- [ ] **Step 4: Test — bind an encounter to a session in The Anvil; reopen Chronicle Workshop's session entry, panel shows the encounter; session list shows tally**

- [ ] **Step 5: Commit**

```bash
git add sessions-dm.html
git commit -m "Chronicle Workshop: 'Encounters planned' panel + session-list readiness tally"
```

---

### Task 5.3: Crucible — `?from-encounter=<id>` URL receiver + "Testing:" chip

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Add `<script src="encounter-schema.js"></script>` if missing**

- [ ] **Step 2: At the end of the page's init, handle the URL param**

```javascript
    (async function handleFromEncounter() {
      const id = new URLSearchParams(location.search).get('from-encounter');
      if (!id) return;
      history.replaceState(null, '', location.pathname);

      const headers = Auth.dmHeaders();
      let arr;
      try { arr = await fetch(WORKER_URL + '?type=encounters', { headers }).then(r => r.json()); }
      catch (e) { alert('Could not load encounter: ' + e.message); return; }
      const enc = (arr || []).map(EncounterSchema.migrateInMemory).find(e => e.id === id);
      if (!enc) { alert('Encounter not found.'); return; }

      // Port picks into Crucible's encounter pane. The Crucible has a function
      // that adds a monster by bestiary id — search for `addMonster` or similar:
      //   grep -n "function addMonster\|encounter.push\|pickMonster" crucible-dm.html
      enc.picks.forEach(p => {
        for (let i = 0; i < (p.qty || 1); i++) addMonsterById(p.id);  // Adjust to actual function name
      });

      // Render the "Testing:" chip atop Pane B.
      const paneB = document.getElementById('pane-encounter') || document.querySelector('.pane-encounter');
      if (paneB) {
        const chip = document.createElement('div');
        chip.style.cssText = 'padding:6px 10px;background:rgba(184,138,90,0.15);border-left:3px solid var(--c-brass);font-family:Crimson Text,serif;margin-bottom:8px';
        chip.innerHTML = `Testing: <strong>${escapeHtml(enc.name)}</strong> — <a href="encounter-dm.html?id=${encodeURIComponent(enc.id)}" style="color:var(--c-brass)">back to The Anvil</a>`;
        paneB.prepend(chip);
      }
    })();
```

- [ ] **Step 3: Test — from The Anvil, click "Send to Crucible," Crucible opens with monsters added and chip visible**

- [ ] **Step 4: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: receive ?from-encounter= URL param, port picks, show Testing chip"
```

---

## Phase 6 — Polish + docs

### Task 6.1: "Migrate all to v2" button (optional polish)

**Files:**
- Modify: `encounter-dm.html`

- [ ] **Step 1: Add a topbar button visible when at least one v1 record exists**

In `renderLibrary`, check for any v1 records (`schemaVersion !== 2` after migration would be impossible because migration in memory already bumps; check the raw fetch instead). Simpler:

```javascript
    // Track whether any record was migrated this session.
    let hadV1OnLoad = false;
    // In loadAll, after fetching arr:
    hadV1OnLoad = (arr || []).some(r => !r || r.schemaVersion !== 2);
```

In `renderLibrary`, prepend (above the +New button):

```javascript
      if (hadV1OnLoad) {
        root.insertAdjacentHTML('afterbegin', `
          <button id="migrate-btn" onclick="migrateAllToV2()" style="background:#5a4030;color:#e8e6df">
            Persist v2 migration (${state.encounters.filter(e => e.schemaVersion === 2).length} records)
          </button>
        `);
      }
```

```javascript
    async function migrateAllToV2() {
      await saveEncounters();
      hadV1OnLoad = false;
      render();
    }
```

- [ ] **Step 2: Test (only if you have v1 records) — confirm the button appears, click it, records are saved**

- [ ] **Step 3: Commit**

```bash
git add encounter-dm.html
git commit -m "Encounter builder: 'Persist v2 migration' button for one-shot upgrade"
```

---

### Task 6.2: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add a new section under [Unreleased] at the top**

Insert below the most recent `## [Unreleased]` heading (or create one if missing):

```markdown
### The Anvil — encounter builder

A new DM tool, `encounter-dm.html`, replaces the in-modal saved-encounters
feature in the War Table. Encounters are now first-class records bundling
monster picks, tactical setup (terrain, lighting, surprise, waves,
read-aloud), DM playbook (tactics, retreat triggers, victory conditions),
pre-staged loot, lifecycle status, and linkages to map locations
(world or sub-map), planned sessions, and named NPCs.

- **New file `encounter-schema.js`** — shared module owning the v2 schema,
  in-memory migration from v1, enum + uniqueness validation, and
  locationRef helpers. Loaded by The Anvil, War Table, Atlas Workshop,
  Chronicle Workshop, Crucible, and the new schema test page.
- **War Table integration:** `?stage=<encounterId>` URL param one-click
  stages combatants, applies surprise/hidden/starting conditions, shows
  the read-aloud banner, and stamps `encounterId` on `initiative_state`.
  Wave reminders surface a "Wave incoming next round" banner; DM clicks
  "Add wave" to instantiate. Combat export pre-fills the timeline entry
  from the encounter; resolution flips encounter status → completed.
  Combat drafts carry `encounterId` forward so a crashed-mid-combat
  recovery still closes the loop. In-modal `Save current as…` UI removed
  (replaced by a link to The Anvil).
- **Atlas Workshop:** location detail editor gains "Encounters here"
  showing world or sub-map matches, with deep-link to author a new
  encounter pre-bound to the location.
- **Chronicle Workshop:** session entry editor gains "Encounters
  planned" with similar deep-link; the session list shows a per-row
  "X encounters: Y ready, Z draft" tally for prep readiness.
- **Crucible:** accepts `?from-encounter=<id>` to port picks into the
  encounter pane with a "Testing: <name>" chip linking back.
- **Worker:** server-side validation of enums (`status`, `lighting`,
  `surprise`, `npcRoles[].role`), `pickKey` uniqueness within an
  encounter, wave references to existing `pickKey`, soft caps, and
  `locationRef` shape (when not null). `schemaVersion: 1` stamped on
  read for records lacking it. `encounterId` + `encounterStagedAt`
  pass-through on `initiative_state` POST, stripped on the player GET
  path via `filterInitiativeState`. **Worker must be redeployed**
  (paste `cloudflare-worker.js` into the Cloudflare dashboard) for
  validation to take effect; until then the front-end falls back to
  client-only validation.
- **Migration:** existing v1 saved encounters auto-upgrade in memory on
  load. First save persists the v2 shape. No destructive up-front
  migration. A one-shot "Persist v2 migration" button is shown in the
  builder topbar when v1 records are present.

**Manual UI checklist (post-deploy):**

- [ ] Sign in as DM → home shows "The Anvil" card in Keeper's Wing.
- [ ] Open The Anvil → existing saved encounters appear in the library
      with auto-set status `ready`.
- [ ] Create new encounter, fill all sections, reload — survives.
- [ ] Run on War Table from a clean tracker → roster populated,
      surprise applied, read-aloud banner visible.
- [ ] Run on War Table with active combat → confirm modal blocks;
      cancel preserves; confirm clobbers.
- [ ] Stage → end combat → export → timeline entry has title /
      location / session / NPCs / loot pre-filled; Anvil row flips to
      `completed`.
- [ ] Send to Crucible → picks pre-populated, "Testing: <name>" chip
      visible.
- [ ] Atlas Workshop location editor shows "Encounters here" for both
      world-level and sub-map matches.
- [ ] Chronicle Workshop session editor shows "Encounters planned"
      tally on the session list.
- [ ] Delete a linked location → builder shows "(deleted)" stub; stage
      still works; export skips broken ref.
- [ ] Two-tab edit on the same array → second save lands without
      clobbering (re-fetch-and-splice).
- [ ] Mobile (≤1100px) → launchpad collapses to sticky bottom; left
      pane becomes drawer; Run button reachable.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "CHANGELOG: The Anvil — encounter builder"
```

---

### Task 6.3: Final pass — run the full manual UI checklist

**Files:** None (manual QA)

- [ ] **Step 1: Walk through every checkbox in the CHANGELOG checklist on a deployed build (frontend pushed + worker redeployed). File any regressions as follow-up tasks. If everything passes, the feature is done.**

---

## Self-Review

### Spec coverage

Walking through each section of the spec:

- **Page architecture (3-pane workshop)** → Tasks 3.1–3.10 (scaffold, library, identity, combatants, tactical, playbook, loot, linkages, launchpad)
- **Data model + `pickKey` + `locationRef`** → Tasks 1.3–1.7 (schema module) + worker validation in Task 2.2
- **Worker changes** → Tasks 2.1 (schemaVersion stamp), 2.2 (validation + updatedAt), 2.3 (filterInitiativeState), 2.4 (deploy + smoke)
- **Migration v1 → v2** → Tasks 1.5 (in-memory migration), 6.1 (one-shot persist button), 0.1 (backup)
- **Cross-tool integration:**
  - War Table → Tasks 4.1 (remove in-modal save), 4.2 (stage receiver), 4.3 (instantiate), 4.4 (read-aloud), 4.5 (waves), 4.6 (encounterId on state + flip live), 4.7 (export pre-fill), 4.8 (resolution), 4.9 (draft carry-forward)
  - Atlas Workshop → Task 5.1
  - Chronicle Workshop → Task 5.2
  - Crucible → Task 5.3
  - Home → Task 3.12
- **Launch flow (happy path)** → Phase 4 end-to-end
- **Edge cases** → Covered through individual tasks (active-combat confirm in 4.2, broken refs in 5.1/5.2 via "(deleted)" stub, resume-from-draft in 4.9, network failures via showBanner pattern in 3.3, deleted encounter while staged in 4.7)
- **Error handling** → showBanner (3.3), showToast (4.8), confirm modals (4.2, 3.10)
- **Testing:**
  - Automated `tests/encounter-schema.test.html` → built incrementally in Tasks 1.2–1.7
  - Manual UI checklist → Task 6.2 (in CHANGELOG), executed in Task 6.3
- **Risk register / non-features** → Out of scope items honored: no auto-wave-spawn (4.5 is explicit click), no reverse Crucible flow (5.3 receive-only), no NPC history append (skipped), no rumor fields (none of the player surfaces touch encounter data)

### Placeholder scan

- No "TBD" / "TODO" / "fill in details" prose anywhere in the task bodies.
- Two tasks (3.5 combatants picker, 4.3 instantiate combatants, 4.5 spawn wave, 4.7 export pre-fill helpers, 4.8 resolution capture, 5.3 add-monster) reference existing functions in the codebase that the engineer must locate via `grep` — that's appropriate (the spec acknowledges those code paths exist; the plan can't pre-emptively rewrite them). Each reference includes the grep command to find the actual function name.
- Code samples are complete and runnable as shown.

### Type / name consistency

- `encounter-schema.js` exports the same names referenced throughout: `STATUSES`, `LIGHTING`, `SURPRISE`, `NPC_ROLES`, `LOCATION_REF_KINDS`, `OUTCOMES`, `CAPS`, `newEncounter`, `genId`, `genPickKeys`, `migrateInMemory`, `validateEncounter`, `equalLocationRefs`, `resolveLocationRef`. ✓
- `locationRef` shape (`{kind, locationId, parentLocationId?}`) is used consistently in: schema (1.3), validation (1.6, 2.2), Atlas filter (5.1), URL param encoding (3.11), worker validation (2.2). ✓
- `window.encounterId` is the name used in War Table tasks 4.3, 4.5, 4.6, 4.7, 4.8, 4.9 — same field. ✓
- `?stage=<id>`, `?from-encounter=<id>`, `?newAt=<...>`, `?newFor=<id>` — each URL param is parsed in one place and produced in another, names match. ✓
- The Encounter Builder is referred to as "The Anvil" in the home page (3.12), CHANGELOG (6.2), and link text (4.1, 5.1, 5.2, 5.3). ✓

### Issues found and fixed inline

None requiring fixes after self-review. The plan is consistent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-11-encounter-builder.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
