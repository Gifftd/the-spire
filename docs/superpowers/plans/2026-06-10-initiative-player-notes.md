# Initiative Player Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players attach short combat-scoped notes to any combatant in the live initiative view, with private/party visibility. Players see their own private notes and everyone's party-visible notes. The DM sees everything read-only. Notes die with the encounter. The same change closes two existing data leaks in the player payload (the DM's "Secret notes" string and `hidden: true` enemies).

**Architecture:** A new shared module `initiative-notes.js` exports four pure functions — `filterInitiativeState`, `mergeDMWritePreservingNotes`, `validateNote`, `canDeleteNote` — plus the two limit constants. Browser pages load it via `<script src>`. The Cloudflare Worker inlines the same source verbatim (with a sync header comment) because Workers can't load external scripts. The worker gains two new POST endpoints (`initiative_note`, `initiative_note_delete`), rewrites GET `initiative_state` to filter per viewer, and gains a notes-preservation merge step in its existing DM `initiative_state` POST handler. The player view (`initiative-player.html`) gets a one-line note preview on collapsed rows and an inline-expand panel with the notes list + add/delete UI. The DM view (`initiative-dm.html`) gets a read-only "Player notes" section on each combatant card's expanded panel.

**Tech Stack:** Plain HTML/CSS/JS (no build step, no framework). Cloudflare Workers + KV for the backend. Tests run via the existing vanilla-HTML harness pattern (see `tests/bestiary-merge.test.html`).

**Spec:** `docs/superpowers/specs/2026-06-10-initiative-player-notes-design.md`

**Branch:** `feature/initiative-player-notes` — stay on this branch throughout. If you switch away (e.g. to a parallel feature branch), in-progress edits become invisible until you switch back.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `initiative-notes.js` | NEW | Pure-function module: `filterInitiativeState`, `mergeDMWritePreservingNotes`, `validateNote`, `canDeleteNote`, plus constants `MAX_NOTE_LENGTH` and `MAX_NOTES_PER_CHARACTER`. IIFE + dual export (CommonJS / window). |
| `tests/initiative-notes.test.html` | NEW | Standalone test page with inline harness. ~22 fixture-based assertions covering all four pure functions. |
| `cloudflare-worker.js` | MODIFY | Inline the four helpers verbatim (sync header). Add `verifyCharacterAuth` helper. Add `PLAYER_WRITE_TYPES` list with `initiative_note` + `initiative_note_delete` handlers. Rewrite GET `initiative_state` to call `filterInitiativeState`. Add notes-preservation merge step to existing DM `initiative_state` POST handler. **Requires manual redeploy.** |
| `initiative-player.html` | MODIFY | Load `initiative-notes.js`. Wire up `Auth` to pass character creds on poll. Render the "📝 ×N preview" line on collapsed rows. Render the expanded panel with notes list, add-note form, delete-own. Add the anonymous login banner. Optimistic update + retry on submit. |
| `initiative-dm.html` | MODIFY | Add read-only "Player notes" section to the combatant-card expanded panel, between the existing "DM NOTES" textarea and the stat block toggle. |
| `CHANGELOG.md` | MODIFY | One entry summarizing the feature + the two leak fixes + the manual deploy reminder. |

**Backups:** Per `CLAUDE.md` repo convention, every modify-task starts by snapshotting touched files into `backups/<timestamp>-initiative-notes-task-N/`.

---

## Phase 1 — Shared pure-logic module + tests

These tasks build the module that both the worker and the browser pages will reuse. Pure functions, no DOM, no Cloudflare globals. Tests run by opening the HTML in a browser and clicking "Run tests."

### Task 1: Create `initiative-notes.js` skeleton + test harness

**Files:**
- Create: `initiative-notes.js`
- Create: `tests/initiative-notes.test.html`

- [ ] **Step 1: Write `initiative-notes.js` with empty exports**

```js
// ═══════════════════════════════════════════════════════════════════════
//  initiative-notes.js
//  Pure helpers for the initiative-tracker player-notes feature.
//
//  Loaded by:
//   • initiative-player.html  (renders previews, validates before POST)
//   • initiative-dm.html      (renders read-only notes panel)
//   • tests/initiative-notes.test.html
//
//  ALSO INLINED VERBATIM IN cloudflare-worker.js — search for the marker
//  "BEGIN initiative-notes.js" in the worker source. Any change to the
//  functions or constants below MUST be mirrored there or the
//  client-side and server-side rules will drift.
// ═══════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────────────
  const MAX_NOTE_LENGTH = 500;             // chars in a single note body
  const MAX_NOTES_PER_CHARACTER = 50;      // per author, per encounter
  const VISIBILITIES = ['private', 'party'];

  // Public exports populated by Tasks 2–5.
  const InitiativeNotes = {
    MAX_NOTE_LENGTH,
    MAX_NOTES_PER_CHARACTER,
    VISIBILITIES,
    // filterInitiativeState        — Task 2
    // mergeDMWritePreservingNotes  — Task 3
    // validateNote                 — Task 4
    // canDeleteNote                — Task 5
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = InitiativeNotes;
  else root.InitiativeNotes = InitiativeNotes;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2: Write `tests/initiative-notes.test.html` with the inline harness**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>initiative-notes tests</title>
  <style>
    body { font: 14px monospace; background:#0e1418; color:#dde7e9; padding:1rem; }
    h1 { color:#7ec5c5; }
    button { padding:0.5rem 1rem; background:#1d3a4a; color:#dde7e9;
             border:1px solid #2c5566; cursor:pointer; }
    .ok   { color:#7fd49a; }
    .fail { color:#e77878; }
    .case { padding:0.25rem 0; border-bottom:1px solid #1c2429; }
    pre   { white-space:pre-wrap; color:#a0adb2; margin:0.25rem 0 0 1rem; }
    #summary { padding:0.75rem; margin-top:1rem; background:#152028;
               border-left:3px solid #7ec5c5; }
  </style>
</head>
<body>
<h1>initiative-notes tests</h1>
<button onclick="runAll()">Run tests</button>
<div id="results"></div>
<div id="summary"></div>

<script src="../initiative-notes.js"></script>
<script>
const TESTS = [];
function test(name, fn) { TESTS.push({ name, fn }); }
function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((label || '') +
    '\n   expected: ' + e + '\n     actual: ' + a);
}
function assertTrue(cond, label) { if (!cond) throw new Error(label || 'expected true'); }
function assertFalse(cond, label) { if (cond) throw new Error(label || 'expected false'); }
async function runAll() {
  const root = document.getElementById('results');
  root.innerHTML = '';
  let pass = 0, fail = 0;
  for (const t of TESTS) {
    const div = document.createElement('div');
    div.className = 'case';
    try {
      await t.fn();
      div.innerHTML = '<span class="ok">✓</span> ' + t.name;
      pass++;
    } catch (e) {
      div.innerHTML = '<span class="fail">✗</span> ' + t.name +
        '<pre>' + (e.message || String(e)) + '</pre>';
      fail++;
    }
    root.appendChild(div);
  }
  document.getElementById('summary').innerHTML =
    `<b>${pass} passed</b>, <b class="${fail?'fail':'ok'}">${fail} failed</b>, ${TESTS.length} total.`;
}
</script>

<script>
// ─────── Smoke test: module loaded ───────
test('module loads + exposes constants', () => {
  assertEq(InitiativeNotes.MAX_NOTE_LENGTH, 500);
  assertEq(InitiativeNotes.MAX_NOTES_PER_CHARACTER, 50);
  assertEq(InitiativeNotes.VISIBILITIES, ['private', 'party']);
});
</script>

</body>
</html>
```

- [ ] **Step 3: Run the test**

Open `tests/initiative-notes.test.html` in a browser (e.g. drag into Chrome, or
`python3 -m http.server 8000` from the repo root and visit
`http://localhost:8000/tests/initiative-notes.test.html`). Click "Run tests".

Expected: **1 passed, 0 failed, 1 total.**

- [ ] **Step 4: Commit**

```bash
git add initiative-notes.js tests/initiative-notes.test.html
git commit -m "initiative-notes: scaffold pure-helper module + test harness"
```

---

### Task 2: `filterInitiativeState` + tests

The function takes an `initiative_state` blob and a `viewer` descriptor and
returns a *new* blob (does not mutate input) with:
- Hidden combatants dropped for non-DM viewers
- `combatant.notes` (DM secret string) stripped for non-DM viewers
- `combatant.playerNotes` filtered per viewer: DM sees all; logged-in player
  sees notes where `visibility === 'party'` OR `authorCharId === viewer.characterId`;
  anonymous sees only `visibility === 'party'`.

**Files:**
- Modify: `initiative-notes.js`
- Modify: `tests/initiative-notes.test.html`

- [ ] **Step 1: Add failing tests to `tests/initiative-notes.test.html`** (paste below the existing `<script>` block that contains the smoke test, inside a new `<script>` block before `</body>`)

```html
<script>
// ─────── filterInitiativeState ───────

// Test fixture: an initiative_state with one of each interesting combatant shape.
function fixture() {
  return {
    mode: 'combat',
    round: 2,
    activeIndex: 0,
    combatants: [
      {
        id: 'c1', name: 'Lyra', type: 'pc', init: 18,
        hp: 22, maxHp: 30, ac: 14,
        conditions: [], dead: false, hidden: false,
        notes: 'DM-only scratch on Lyra',
        playerNotes: [
          { id: 'n1', combatantId: 'c1', authorCharId: 'char_lyra',
            authorName: 'Lyra', body: 'My HP is fine', visibility: 'private',
            createdAt: 1000 },
          { id: 'n2', combatantId: 'c1', authorCharId: 'char_garruk',
            authorName: 'Garruk', body: 'Lyra is concentrating', visibility: 'party',
            createdAt: 2000 }
        ]
      },
      {
        id: 'c2', name: 'Goblin Captain', type: 'enemy', init: 15,
        hp: 18, maxHp: 25, ac: 13,
        conditions: ['poisoned'], dead: false, hidden: false,
        notes: 'Has the key',
        playerNotes: [
          { id: 'n3', combatantId: 'c2', authorCharId: 'char_lyra',
            authorName: 'Lyra', body: 'Fire resistant', visibility: 'party',
            createdAt: 3000 },
          { id: 'n4', combatantId: 'c2', authorCharId: 'char_lyra',
            authorName: 'Lyra', body: 'Owes me 20gp', visibility: 'private',
            createdAt: 4000 }
        ]
      },
      {
        id: 'c3', name: 'Hidden Cultist', type: 'enemy', init: 12,
        hp: 10, maxHp: 10, ac: 12,
        conditions: [], dead: false, hidden: true,
        notes: 'Strikes from shadow on round 3',
        playerNotes: [
          { id: 'n5', combatantId: 'c3', authorCharId: 'char_lyra',
            authorName: 'Lyra', body: 'Should never see this', visibility: 'party',
            createdAt: 5000 }
        ]
      }
    ]
  };
}

test('filter: DM sees everything (notes string, hidden combatant, all playerNotes)', () => {
  const state = fixture();
  const out = InitiativeNotes.filterInitiativeState(state, { role: 'dm' });
  assertEq(out.combatants.length, 3, 'DM sees all 3 combatants');
  assertEq(out.combatants[0].notes, 'DM-only scratch on Lyra', 'DM sees notes string');
  assertEq(out.combatants[0].playerNotes.length, 2, 'DM sees both notes on Lyra');
  assertEq(out.combatants[2].name, 'Hidden Cultist', 'DM sees hidden combatant');
});

test('filter: logged-in player drops hidden, strips notes, filters playerNotes', () => {
  const state = fixture();
  const out = InitiativeNotes.filterInitiativeState(state, {
    role: 'player', characterId: 'char_lyra'
  });
  assertEq(out.combatants.length, 2, 'hidden combatant dropped (2 not 3)');
  out.combatants.forEach(c => assertEq(c.notes, undefined, 'DM notes string stripped'));
  // Lyra: sees her own private + everyone's party = 2 notes
  assertEq(out.combatants[0].playerNotes.length, 2);
  // Goblin: sees party-visible "Fire resistant" + her own private "Owes me 20gp" = 2
  assertEq(out.combatants[1].playerNotes.length, 2);
});

test('filter: anonymous viewer sees only party-visible notes', () => {
  const state = fixture();
  const out = InitiativeNotes.filterInitiativeState(state, null);
  assertEq(out.combatants.length, 2, 'hidden combatant dropped for anonymous');
  out.combatants.forEach(c => assertEq(c.notes, undefined, 'DM notes string stripped'));
  // Lyra: only "Lyra is concentrating" (party) = 1 note
  assertEq(out.combatants[0].playerNotes.length, 1);
  assertEq(out.combatants[0].playerNotes[0].body, 'Lyra is concentrating');
  // Goblin: only "Fire resistant" (party) = 1 note
  assertEq(out.combatants[1].playerNotes.length, 1);
  assertEq(out.combatants[1].playerNotes[0].body, 'Fire resistant');
});

test('filter: does not mutate input state', () => {
  const state = fixture();
  const before = JSON.stringify(state);
  InitiativeNotes.filterInitiativeState(state, null);
  assertEq(JSON.parse(JSON.stringify(state)), JSON.parse(before),
    'input unchanged after filter');
});

test('filter: tolerates missing playerNotes / missing combatants array', () => {
  // missing playerNotes per combatant
  const s1 = { mode: 'combat', combatants: [{ id: 'c1', name: 'A', hidden: false }] };
  const o1 = InitiativeNotes.filterInitiativeState(s1, null);
  assertEq(o1.combatants[0].playerNotes, [], 'missing playerNotes → []');

  // missing combatants entirely
  const s2 = { mode: 'lobby' };
  const o2 = InitiativeNotes.filterInitiativeState(s2, null);
  assertEq(o2.combatants, [], 'missing combatants → []');

  // null state
  const o3 = InitiativeNotes.filterInitiativeState(null, null);
  assertEq(o3, { combatants: [] }, 'null state → empty combatants');
});

test('filter: viewer with role:player but no characterId acts like anonymous', () => {
  const state = fixture();
  const out = InitiativeNotes.filterInitiativeState(state, { role: 'player' });
  // No characterId → no "own private" path matches → only party
  assertEq(out.combatants[0].playerNotes.length, 1, 'only party-visible on Lyra');
  assertEq(out.combatants[1].playerNotes.length, 1, 'only party-visible on Goblin');
});
</script>
```

- [ ] **Step 2: Run the tests to confirm they fail**

Reload `tests/initiative-notes.test.html`, click "Run tests."

Expected: **1 passed, 6 failed, 7 total** — all the filter tests fail with
"InitiativeNotes.filterInitiativeState is not a function".

- [ ] **Step 3: Implement `filterInitiativeState` in `initiative-notes.js`**

Replace the comment line `// filterInitiativeState — Task 2` and add the
implementation. Insert ABOVE the `const InitiativeNotes = {` line:

```js
  // ─── filterInitiativeState(state, viewer) ──────────────────────────
  // Returns a NEW state with hidden combatants dropped (non-DM), the
  // DM-only `notes` string stripped (non-DM), and `playerNotes` filtered
  // per viewer.
  //   viewer = { role: 'dm' }                              → see everything
  //   viewer = { role: 'player', characterId: 'char_x' }   → own private + party
  //   viewer = null | { role: 'player' /* no id */ }       → party only
  function filterInitiativeState(state, viewer) {
    if (!state || typeof state !== 'object') return { combatants: [] };
    const isDM = !!(viewer && viewer.role === 'dm');
    const myId = (viewer && viewer.role === 'player' && viewer.characterId) || null;

    const combatants = Array.isArray(state.combatants) ? state.combatants : [];
    const filtered = [];
    for (const c of combatants) {
      if (!c) continue;
      if (!isDM && c.hidden) continue;          // drop hidden for non-DM

      // Shallow clone so we don't mutate input
      const clone = Object.assign({}, c);
      if (!isDM) delete clone.notes;            // strip DM secret string

      // Filter playerNotes
      const allNotes = Array.isArray(c.playerNotes) ? c.playerNotes : [];
      if (isDM) {
        clone.playerNotes = allNotes.slice();    // copy, keep all
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

    // Shallow-clone the outer state so other fields (mode, round, etc.) pass through
    const out = Object.assign({}, state);
    out.combatants = filtered;
    return out;
  }
```

Then add `filterInitiativeState` to the `InitiativeNotes` export object:

```js
  const InitiativeNotes = {
    MAX_NOTE_LENGTH,
    MAX_NOTES_PER_CHARACTER,
    VISIBILITIES,
    filterInitiativeState,
    // mergeDMWritePreservingNotes  — Task 3
    // validateNote                 — Task 4
    // canDeleteNote                — Task 5
  };
```

- [ ] **Step 4: Run the tests**

Reload `tests/initiative-notes.test.html`, click "Run tests."

Expected: **7 passed, 0 failed, 7 total.**

- [ ] **Step 5: Commit**

```bash
git add initiative-notes.js tests/initiative-notes.test.html
git commit -m "initiative-notes: filterInitiativeState + tests"
```

---

### Task 3: `mergeDMWritePreservingNotes` + tests

Worker-side merge: when the DM POSTs a fresh `initiative_state`, copy any
existing `playerNotes` from KV onto the incoming combatants matched by `id`,
so the DM's frequent rewrites don't clobber player notes (§4.5 of spec).

**Files:**
- Modify: `initiative-notes.js`
- Modify: `tests/initiative-notes.test.html`

- [ ] **Step 1: Add failing tests to `tests/initiative-notes.test.html`** (append a new `<script>` block before `</body>`)

```html
<script>
// ─────── mergeDMWritePreservingNotes ───────

test('merge: copies prev playerNotes onto matching incoming combatants', () => {
  const prev = {
    combatants: [
      { id: 'c1', name: 'Old name', hp: 5,
        playerNotes: [{ id: 'n1', body: 'keep me' }] },
      { id: 'c2', name: 'Goblin', hp: 10,
        playerNotes: [{ id: 'n2', body: 'also keep' }] }
    ]
  };
  const incoming = {
    combatants: [
      { id: 'c1', name: 'New name', hp: 3 },        // DM renamed + damaged
      { id: 'c2', name: 'Goblin', hp: 0, dead: true } // DM killed
    ]
  };
  const out = InitiativeNotes.mergeDMWritePreservingNotes(prev, incoming);
  assertEq(out.combatants[0].name, 'New name', 'DM name change preserved');
  assertEq(out.combatants[0].hp, 3, 'DM HP change preserved');
  assertEq(out.combatants[0].playerNotes, [{ id: 'n1', body: 'keep me' }],
    'prev notes copied to c1');
  assertEq(out.combatants[1].playerNotes, [{ id: 'n2', body: 'also keep' }],
    'prev notes copied to c2');
});

test('merge: combatants the DM removed are gone (notes dropped)', () => {
  const prev = {
    combatants: [
      { id: 'c1', playerNotes: [{ id: 'n1' }] },
      { id: 'c2', playerNotes: [{ id: 'n2' }] }
    ]
  };
  const incoming = { combatants: [{ id: 'c1' }] };  // c2 removed
  const out = InitiativeNotes.mergeDMWritePreservingNotes(prev, incoming);
  assertEq(out.combatants.length, 1);
  assertEq(out.combatants[0].id, 'c1');
});

test('merge: new combatants the DM added start with empty playerNotes', () => {
  const prev = { combatants: [{ id: 'c1', playerNotes: [{ id: 'n1' }] }] };
  const incoming = { combatants: [
    { id: 'c1' },
    { id: 'c2', name: 'New goblin' }  // newly added by DM
  ]};
  const out = InitiativeNotes.mergeDMWritePreservingNotes(prev, incoming);
  assertEq(out.combatants[1].playerNotes, [], 'new combatant → empty notes');
});

test('merge: DM-supplied playerNotes on a new combatant are discarded', () => {
  // Defense in depth: the DM tracker doesn't author notes, but if a malicious
  // client tried to inject them, we drop them. New combatants always start [].
  const prev = { combatants: [] };
  const incoming = { combatants: [
    { id: 'c1', playerNotes: [{ id: 'evil', body: 'injected' }] }
  ]};
  const out = InitiativeNotes.mergeDMWritePreservingNotes(prev, incoming);
  assertEq(out.combatants[0].playerNotes, [], 'injected notes discarded');
});

test('merge: lobby reset (empty incoming combatants) clears all notes', () => {
  const prev = { combatants: [
    { id: 'c1', playerNotes: [{ id: 'n1' }] }
  ]};
  const incoming = { mode: 'lobby', combatants: [] };
  const out = InitiativeNotes.mergeDMWritePreservingNotes(prev, incoming);
  assertEq(out.combatants, [], 'lobby reset → no combatants');
  assertEq(out.mode, 'lobby', 'other incoming fields preserved');
});

test('merge: tolerates missing prev / missing combatants arrays', () => {
  const o1 = InitiativeNotes.mergeDMWritePreservingNotes(null, { combatants: [{id:'c1'}] });
  assertEq(o1.combatants[0].playerNotes, [], 'null prev → empty notes');

  const o2 = InitiativeNotes.mergeDMWritePreservingNotes({}, { combatants: [{id:'c1'}] });
  assertEq(o2.combatants[0].playerNotes, [], 'empty prev → empty notes');

  const o3 = InitiativeNotes.mergeDMWritePreservingNotes({ combatants: [] }, {});
  assertEq(o3.combatants, [], 'incoming with no combatants → empty array');
});

test('merge: does not mutate inputs', () => {
  const prev = { combatants: [{ id: 'c1', playerNotes: [{ id: 'n1' }] }] };
  const incoming = { combatants: [{ id: 'c1', hp: 5 }] };
  const prevSnap = JSON.stringify(prev);
  const incSnap  = JSON.stringify(incoming);
  InitiativeNotes.mergeDMWritePreservingNotes(prev, incoming);
  assertEq(JSON.parse(JSON.stringify(prev)),     JSON.parse(prevSnap), 'prev unchanged');
  assertEq(JSON.parse(JSON.stringify(incoming)), JSON.parse(incSnap),  'incoming unchanged');
});
</script>
```

- [ ] **Step 2: Run tests, confirm 7 new tests fail**

Reload + Run tests. Expected: 7 passed (from Tasks 1+2), 7 failed (the new
merge tests), 14 total.

- [ ] **Step 3: Implement `mergeDMWritePreservingNotes` in `initiative-notes.js`**

Insert above the `const InitiativeNotes = {` line:

```js
  // ─── mergeDMWritePreservingNotes(prev, incoming) ───────────────────
  // Server-side merge for the DM `initiative_state` POST handler.
  // The DM tracker never authors playerNotes, so KV is authoritative.
  // We copy prev.combatants[i].playerNotes (keyed by id) onto matching
  // incoming combatants. New combatants the DM added start with [].
  // DM-supplied playerNotes on new combatants are discarded as defense
  // in depth. Returns a new state; does not mutate inputs.
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
```

Add `mergeDMWritePreservingNotes` to the exports:

```js
  const InitiativeNotes = {
    MAX_NOTE_LENGTH,
    MAX_NOTES_PER_CHARACTER,
    VISIBILITIES,
    filterInitiativeState,
    mergeDMWritePreservingNotes,
    // validateNote                 — Task 4
    // canDeleteNote                — Task 5
  };
```

- [ ] **Step 4: Run tests**

Expected: **14 passed, 0 failed, 14 total.**

- [ ] **Step 5: Commit**

```bash
git add initiative-notes.js tests/initiative-notes.test.html
git commit -m "initiative-notes: mergeDMWritePreservingNotes + tests"
```

---

### Task 4: `validateNote` + tests

Pure input validation for incoming note bodies and visibility. Used by both
the worker (defense in depth) and the player UI (to gate the Save button).
Returns `{ ok: true }` or `{ ok: false, error: '<reason>' }`.

**Files:**
- Modify: `initiative-notes.js`
- Modify: `tests/initiative-notes.test.html`

- [ ] **Step 1: Add failing tests** (append a new `<script>` block before `</body>`)

```html
<script>
// ─────── validateNote ───────

test('validate: accepts a normal note', () => {
  const r = InitiativeNotes.validateNote({ body: 'Resistant to fire', visibility: 'party' });
  assertEq(r, { ok: true });
});

test('validate: rejects empty body', () => {
  const r = InitiativeNotes.validateNote({ body: '', visibility: 'party' });
  assertEq(r.ok, false);
  assertTrue(/empty|required/i.test(r.error), 'mentions empty/required');
});

test('validate: rejects whitespace-only body', () => {
  const r = InitiativeNotes.validateNote({ body: '   \n  ', visibility: 'party' });
  assertEq(r.ok, false);
});

test('validate: rejects body > MAX_NOTE_LENGTH chars', () => {
  const tooLong = 'x'.repeat(InitiativeNotes.MAX_NOTE_LENGTH + 1);
  const r = InitiativeNotes.validateNote({ body: tooLong, visibility: 'party' });
  assertEq(r.ok, false);
  assertTrue(/long|length|500/i.test(r.error));
});

test('validate: accepts body == MAX_NOTE_LENGTH chars', () => {
  const exact = 'x'.repeat(InitiativeNotes.MAX_NOTE_LENGTH);
  const r = InitiativeNotes.validateNote({ body: exact, visibility: 'party' });
  assertEq(r.ok, true);
});

test('validate: rejects invalid visibility', () => {
  const r = InitiativeNotes.validateNote({ body: 'ok', visibility: 'secret' });
  assertEq(r.ok, false);
  assertTrue(/visibility/i.test(r.error));
});

test('validate: accepts both legal visibilities', () => {
  assertEq(InitiativeNotes.validateNote({ body:'a', visibility:'private' }).ok, true);
  assertEq(InitiativeNotes.validateNote({ body:'a', visibility:'party'   }).ok, true);
});

test('validate: rejects missing/null/non-object input', () => {
  assertEq(InitiativeNotes.validateNote(null).ok, false);
  assertEq(InitiativeNotes.validateNote(undefined).ok, false);
  assertEq(InitiativeNotes.validateNote('a string').ok, false);
});
</script>
```

- [ ] **Step 2: Run tests, confirm 8 new failures**

Expected: 14 passed, 8 failed, 22 total.

- [ ] **Step 3: Implement `validateNote`**

Insert above the `const InitiativeNotes = {` line:

```js
  // ─── validateNote(input) ───────────────────────────────────────────
  // Validates a candidate note's body + visibility. Returns
  // { ok: true } or { ok: false, error: '<reason>' }. Pure.
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
```

Add `validateNote` to the exports object.

- [ ] **Step 4: Run tests**

Expected: **22 passed, 0 failed, 22 total.**

- [ ] **Step 5: Commit**

```bash
git add initiative-notes.js tests/initiative-notes.test.html
git commit -m "initiative-notes: validateNote + tests"
```

---

### Task 5: `canDeleteNote` + tests + complete the module

**Files:**
- Modify: `initiative-notes.js`
- Modify: `tests/initiative-notes.test.html`

- [ ] **Step 1: Add failing tests** (append new `<script>` block)

```html
<script>
// ─────── canDeleteNote ───────

const sampleNote = { id: 'n1', authorCharId: 'char_lyra', body: 'x', visibility: 'private' };

test('canDelete: author can delete own note', () => {
  assertEq(InitiativeNotes.canDeleteNote(sampleNote, { role: 'player', characterId: 'char_lyra' }), true);
});

test('canDelete: other player cannot delete', () => {
  assertEq(InitiativeNotes.canDeleteNote(sampleNote, { role: 'player', characterId: 'char_garruk' }), false);
});

test('canDelete: DM can delete any note', () => {
  assertEq(InitiativeNotes.canDeleteNote(sampleNote, { role: 'dm' }), true);
});

test('canDelete: anonymous viewer cannot delete', () => {
  assertEq(InitiativeNotes.canDeleteNote(sampleNote, null), false);
  assertEq(InitiativeNotes.canDeleteNote(sampleNote, { role: 'player' }), false);
});

test('canDelete: missing note → false (safe default)', () => {
  assertEq(InitiativeNotes.canDeleteNote(null, { role: 'dm' }), false);
});
</script>
```

- [ ] **Step 2: Run, confirm 5 new failures**

Expected: 22 passed, 5 failed, 27 total.

- [ ] **Step 3: Implement `canDeleteNote`**

Insert above the `const InitiativeNotes = {` line:

```js
  // ─── canDeleteNote(note, viewer) ───────────────────────────────────
  // Authorization rule for note deletion. The note's author can delete
  // their own; the DM can delete any; everyone else (other players,
  // anonymous) cannot.
  function canDeleteNote(note, viewer) {
    if (!note || !viewer) return false;
    if (viewer.role === 'dm') return true;
    if (viewer.role === 'player' && viewer.characterId
        && note.authorCharId === viewer.characterId) return true;
    return false;
  }
```

Add `canDeleteNote` to the exports object. The final `InitiativeNotes` object
should now read:

```js
  const InitiativeNotes = {
    MAX_NOTE_LENGTH,
    MAX_NOTES_PER_CHARACTER,
    VISIBILITIES,
    filterInitiativeState,
    mergeDMWritePreservingNotes,
    validateNote,
    canDeleteNote,
  };
```

- [ ] **Step 4: Run tests**

Expected: **27 passed, 0 failed, 27 total.**

- [ ] **Step 5: Commit**

```bash
git add initiative-notes.js tests/initiative-notes.test.html
git commit -m "initiative-notes: canDeleteNote + complete the module"
```

---

## Phase 2 — Worker integration

The worker can't load external scripts, so the four pure helpers are
copy-pasted into the worker source verbatim, with a sync-header comment.
The worker then gains:
- `verifyCharacterAuth(body, env)` helper (new)
- Two new POST handlers under a new `PLAYER_WRITE_TYPES` list
- A rewritten GET `initiative_state` handler that calls `filterInitiativeState`
- A new merge step inside the existing DM POST `initiative_state` handler

**The worker requires manual redeploy to Cloudflare at the end of this phase.**
Until that deploy, the new endpoints don't exist and the new UI in Phase 3 will
fail on every write. Do not start Phase 3 until Phase 2 ends with a working
deployed worker.

### Task 6: Snapshot worker + inline the pure helpers

**Files:**
- Backup: `cloudflare-worker.js` → `backups/<timestamp>-initiative-notes-task-6/`
- Modify: `cloudflare-worker.js`

- [ ] **Step 1: Snapshot**

```bash
ts=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${ts}-initiative-notes-task-6"
cp cloudflare-worker.js "backups/${ts}-initiative-notes-task-6/"
```

- [ ] **Step 2: Open `cloudflare-worker.js` and find a sensible insertion point**

The worker is a single-file module. Inline the helpers near the top of
the `default { fetch(...) }` block, immediately after the existing CORS
constants but before the request handler logic. Search for the line
containing `'Access-Control-Allow-Headers'` (around line 27) — insert the
helpers after the constant block, before the first handler.

- [ ] **Step 3: Paste the inlined helpers**

Insert the following block (copy the function bodies verbatim from
`initiative-notes.js`):

```js
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
```

- [ ] **Step 4: Lint-check the worker (no deploy yet)**

```bash
node --check cloudflare-worker.js
```

Expected: exits with status 0, no output. (Syntax-only check.)

- [ ] **Step 5: Commit**

```bash
git add cloudflare-worker.js
git commit -m "worker: inline initiative-notes pure helpers (sync with initiative-notes.js)"
```

---

### Task 7: Add `verifyCharacterAuth` helper to worker

Mirrors the inline validation in the existing `character_login` and `brew`
handlers, factored into one helper for the two new POST handlers to share.

**Files:**
- Modify: `cloudflare-worker.js`

- [ ] **Step 1: Snapshot**

```bash
ts=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${ts}-initiative-notes-task-7"
cp cloudflare-worker.js "backups/${ts}-initiative-notes-task-7/"
```

- [ ] **Step 2: Find `verifyDMAuth`**

Open `cloudflare-worker.js`. Find the existing function `verifyDMAuth`
(roughly around line 75 — search for `function verifyDMAuth`).

- [ ] **Step 3: Add `verifyCharacterAuth` immediately after `verifyDMAuth`**

```js
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
```

- [ ] **Step 4: Lint check**

```bash
node --check cloudflare-worker.js
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add cloudflare-worker.js
git commit -m "worker: add verifyCharacterAuth helper for player POST endpoints"
```

---

### Task 8: Add `initiative_note` POST handler

**Files:**
- Modify: `cloudflare-worker.js`

- [ ] **Step 1: Snapshot**

```bash
ts=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${ts}-initiative-notes-task-8"
cp cloudflare-worker.js "backups/${ts}-initiative-notes-task-8/"
```

- [ ] **Step 2: Locate the POST request block**

In `cloudflare-worker.js`, find the line `if (DM_WRITE_TYPES.includes(body?.type))`
(around line 675). The new `initiative_note` handler goes ABOVE this block
(player handlers run before the DM-write gate, since they have their own auth).
Find the line `if (body?.type === 'brew')` (around line 591) — that's the
closest existing precedent for body-based player auth. Insert the new handler
just before the `brew` handler so they sit together.

- [ ] **Step 3: Paste the handler**

```js
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
      const idx = combatants.findIndex(c => c && c.id === combatantId);
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
```

- [ ] **Step 4: Lint check**

```bash
node --check cloudflare-worker.js
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add cloudflare-worker.js
git commit -m "worker: initiative_note POST handler (player-authored notes)"
```

---

### Task 9: Add `initiative_note_delete` POST handler

**Files:**
- Modify: `cloudflare-worker.js`

- [ ] **Step 1: Snapshot**

```bash
ts=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${ts}-initiative-notes-task-9"
cp cloudflare-worker.js "backups/${ts}-initiative-notes-task-9/"
```

- [ ] **Step 2: Insert the handler immediately after the `initiative_note` handler**

```js
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
      const idx = combatants.findIndex(c => c && c.id === combatantId);
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
```

- [ ] **Step 3: Lint check**

```bash
node --check cloudflare-worker.js
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add cloudflare-worker.js
git commit -m "worker: initiative_note_delete POST handler"
```

---

### Task 10: Filter GET `initiative_state` per viewer

Replace the unfiltered return with the three-branch filtered version from
the spec §4.2. This closes the existing leaks of `combatant.notes` and
`hidden: true` enemies, in addition to filtering the new `playerNotes`.

**Files:**
- Modify: `cloudflare-worker.js`

- [ ] **Step 1: Snapshot**

```bash
ts=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${ts}-initiative-notes-task-10"
cp cloudflare-worker.js "backups/${ts}-initiative-notes-task-10/"
```

- [ ] **Step 2: Find the existing handler**

Around line 332 of `cloudflare-worker.js`:

```js
      // Initiative state — readable by everyone (players need it to see turn order)
      if (type === 'initiative_state') {
        const value = await kvGet(env, type, {});
        return json(value);
      }
```

- [ ] **Step 3: Replace it with the filtered version**

```js
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
```

- [ ] **Step 4: Lint check**

```bash
node --check cloudflare-worker.js
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add cloudflare-worker.js
git commit -m "worker: filter initiative_state GET per viewer (closes notes + hidden leaks)"
```

---

### Task 11: Add notes-preservation merge to DM `initiative_state` POST

Without this, the DM's frequent HP/condition writes would silently wipe
player notes (spec §4.5).

**Files:**
- Modify: `cloudflare-worker.js`

- [ ] **Step 1: Snapshot**

```bash
ts=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${ts}-initiative-notes-task-11"
cp cloudflare-worker.js "backups/${ts}-initiative-notes-task-11/"
```

- [ ] **Step 2: Find the DM_WRITE_TYPES branch**

In `cloudflare-worker.js`, around line 673–681, the existing handler reads:

```js
    // ── DM-only writes ────────────────────────────────────────
    const DM_WRITE_TYPES = ['initiative_state','map_data','map_data_dm', /* … */];
    if (DM_WRITE_TYPES.includes(body?.type)) {
      const auth = await verifyDMAuth(request, env);
      if (!auth.ok) return json({ error: 'DM auth required' }, 401);
      const ok = await kvPut(env, body.type, body.payload);
      if (!ok) return json({ error: 'KV not bound' }, 500);
      return json({ ok: true, ...(auth.warning ? { warning: auth.warning } : {}) });
    }
```

**Important:** the DM tracker sends `{ type, payload }` — the actual state
is in `body.payload`, not `body` itself. Our merge must operate on the
payload.

- [ ] **Step 3: Insert the merge step and write the merged payload**

Replace the block above with:

```js
    // ── DM-only writes ────────────────────────────────────────
    const DM_WRITE_TYPES = ['initiative_state','map_data','map_data_dm','characters','journals','npcs','timeline','potion_ingredients','potions','negative_potions','potion_inventories','potion_recipes','potion_library','bestiary','bestiary_custom','encounters','feature_library'];
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
```

**Verify the DM_WRITE_TYPES array exactly matches the existing one** —
copy it from the current source if it has changed since this plan was
written. The merge step is the only behavioral change.

- [ ] **Step 4: Lint check**

```bash
node --check cloudflare-worker.js
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add cloudflare-worker.js
git commit -m "worker: preserve playerNotes on DM initiative_state writes (spec §4.5)"
```

---

### Task 12: Deploy worker + smoke test live

**This is the only deploy in the plan and it's manual.** The new UI in Phase 3
cannot be exercised before this completes.

**Files:** (no edits; manual dashboard step + curl probes)

- [ ] **Step 1: Open the Cloudflare worker editor**

Open <https://dash.cloudflare.com/> → Workers & Pages → `dnd-perk-webhook`
→ Edit code. The script editor opens.

- [ ] **Step 2: Paste the new worker source**

Open `cloudflare-worker.js` from this repo, select all (`Cmd-A`), copy
(`Cmd-C`). In the Cloudflare editor, select all, paste. Click **Save and
deploy**. Wait for the green "Deployed" toast.

- [ ] **Step 3: Smoke test the filtered GET — anonymous**

```bash
curl -s 'https://dnd-perk-webhook.jacobgiff.workers.dev/?type=initiative_state' | python3 -m json.tool | head -40
```

Expected: returns `combatants` array. For each combatant, **`notes` field is
absent** (or empty string only if the DM never set one). Hidden combatants
(those with `hidden: true` in KV) are not in the array. `playerNotes` arrays
contain only `visibility: 'party'` entries (or are empty).

- [ ] **Step 4: Smoke test the filtered GET — player**

Pick a real character from KV (one with a known claim code). Substitute
`<CHAR_ID>` and `<CODE>`:

```bash
curl -s 'https://dnd-perk-webhook.jacobgiff.workers.dev/?type=initiative_state&characterId=<CHAR_ID>&code=<CODE>' | python3 -m json.tool | head -40
```

Expected: still no `notes` string, still no hidden combatants, but any
`playerNotes` authored by `<CHAR_ID>` with `visibility: 'private'` are now
visible.

- [ ] **Step 5: Smoke test the filtered GET — DM**

Substitute `<DM_USER>` and `<DM_PASS>`:

```bash
curl -s -H 'X-DM-User: <DM_USER>' -H 'X-DM-Pass: <DM_PASS>' \
  'https://dnd-perk-webhook.jacobgiff.workers.dev/?type=initiative_state' \
  | python3 -m json.tool | head -40
```

Expected: full unfiltered state. `notes` strings present, hidden combatants
present, all `playerNotes` visible.

- [ ] **Step 6: Smoke test `initiative_note` POST**

You'll need an existing combatant in the live initiative. Either ask the DM
to set one up or look at the GET response in Step 4 and copy a `combatant.id`.
Substitute `<CHAR_ID>`, `<CODE>`, and `<COMBATANT_ID>`:

```bash
curl -s -X POST 'https://dnd-perk-webhook.jacobgiff.workers.dev/' \
  -H 'Content-Type: application/json' \
  -d '{
    "type":"initiative_note",
    "characterId":"<CHAR_ID>","code":"<CODE>",
    "combatantId":"<COMBATANT_ID>",
    "body":"Smoke test note",
    "visibility":"party"
  }' | python3 -m json.tool
```

Expected: `{ "ok": true, "note": { "id": "n_…", ... } }`.

Then re-run the player GET from Step 4 — the new note should appear.

- [ ] **Step 7: Smoke test `initiative_note_delete`**

Using the note id from Step 6:

```bash
curl -s -X POST 'https://dnd-perk-webhook.jacobgiff.workers.dev/' \
  -H 'Content-Type: application/json' \
  -d '{
    "type":"initiative_note_delete",
    "characterId":"<CHAR_ID>","code":"<CODE>",
    "combatantId":"<COMBATANT_ID>",
    "noteId":"<NOTE_ID_FROM_STEP_6>"
  }' | python3 -m json.tool
```

Expected: `{ "ok": true }`. GET again — note is gone.

- [ ] **Step 8: Smoke test merge-preserves-notes on DM write**

Post a fresh test note (Step 6 again). Then have the DM open
`initiative-dm.html`, edit the same combatant's HP (any non-trivial change),
and let `pushState` fire. Re-run the player GET. **The note must still be
there.** If it's gone, the merge step (Task 11) is wired wrong — abort and
fix before continuing to Phase 3.

- [ ] **Step 9: No commit needed**

This task is deploy + verification only.

---

## Phase 3 — Player UI (`initiative-player.html`)

The bulk of the UI work. Each task adds one slice of behavior and ends with
a manual smoke test in a real browser.

### Task 13: Wire up `Auth` module + creds-in-poll-URL

**Files:**
- Backup: `initiative-player.html`
- Modify: `initiative-player.html`

- [ ] **Step 1: Snapshot**

```bash
ts=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${ts}-initiative-notes-task-13"
cp initiative-player.html "backups/${ts}-initiative-notes-task-13/"
```

- [ ] **Step 2: Open `initiative-player.html` and find the `<script>` block at line 209**

Just below `<script src="auth.js"></script>`. The existing `poll()` (around
line 302) hits the worker without any creds.

- [ ] **Step 3: Add a load for `initiative-notes.js` just below `auth.js`**

```html
<script src="auth.js"></script>
<script src="initiative-notes.js"></script>
```

- [ ] **Step 4: Rewrite `poll()` to include creds when logged in**

Replace the existing `poll()` function (starts at `async function poll() {`)
with:

```js
function buildStateUrl() {
  // Auth.playerCreds() returns { characterId, code, name } for logged-in players,
  // or null if anonymous/DM. (Defined in auth.js around line 138.)
  const me = (window.Auth && Auth.playerCreds && Auth.playerCreds()) || null;
  let url = WORKER_URL + '?type=initiative_state';
  if (me && me.characterId && me.code) {
    url += '&characterId=' + encodeURIComponent(me.characterId)
        +  '&code='        + encodeURIComponent(me.code);
  }
  return url;
}

async function poll() {
  try {
    const res  = await fetch(buildStateUrl(), { cache: 'no-store' });
    if (!res.ok) {
      // 401 means our player creds were rotated — fall back to anonymous next tick.
      // Auth.logout() clears the whole spire-auth blob; since localStorage holds
      // one role at a time, this is equivalent to clearing player creds when
      // role === 'player'.
      if (res.status === 401 && window.Auth && Auth.logout) Auth.logout();
      throw new Error(res.status);
    }
    const data = await res.json();
    failCount  = 0;

    const bar = document.getElementById('conn-bar');
    bar.className   = 'conn-bar live';
    bar.textContent = '✦ Live — updates every few seconds';

    if (data && typeof data.mode !== 'undefined') {
      if (data.mode === 'lobby') {
        showLobby();
      } else {
        showCombat(data);
      }
      lastMode = data.mode;
    }
  } catch {
    failCount++;
    const bar = document.getElementById('conn-bar');
    if (failCount > 3) {
      bar.className   = 'conn-bar error';
      bar.textContent = '⚠ Connection lost — retrying…';
    }
  }
  setTimeout(poll, POLL_MS);
}
```

**Note:** This relies on the existing `Auth.playerCreds()` accessor in
`auth.js` (around line 138) — it returns the player's `{ characterId,
code, name }` from localStorage or `null` if not logged in. We do not
add any new accessors to `auth.js`.

- [ ] **Step 5: Smoke test**

In a browser, open `initiative-player.html` directly (or via
`python3 -m http.server`). Open DevTools → Network tab → filter to the
worker URL. Confirm the GET request fires every 2.5s. With no player
login in localStorage, URL should be plain `?type=initiative_state`. After
logging in via `home.html` (which uses the existing `character_login`),
re-open the player page — the URL should now include
`&characterId=...&code=...`.

- [ ] **Step 6: Commit**

```bash
git add initiative-player.html
git commit -m "initiative-player: wire Auth creds into poll URL"
```

---

### Task 14: Preview line on collapsed rows + visual styling

**Files:**
- Modify: `initiative-player.html`

- [ ] **Step 1: Snapshot**

```bash
ts=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${ts}-initiative-notes-task-14"
cp initiative-player.html "backups/${ts}-initiative-notes-task-14/"
```

- [ ] **Step 2: Add the preview CSS**

In the existing `<style>` block (between `<style>` at line 9 and `</style>`
at line 178), add a new section just before `</style>`:

```css
/* ── Player notes preview (on collapsed row) ── */
.notes-preview {
  display: flex; align-items: center; gap: 6px;
  margin-top: 5px;
  font-size: 0.78rem;
  color: var(--ink-dim);
  font-style: italic;
  /* truncate to one line */
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.notes-preview .pn-icon {
  color: var(--gold-light); font-style: normal;
  font-size: 0.85rem;
}
.notes-preview .pn-count {
  font-family: 'Cinzel', serif;
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  color: var(--gold-faint);
  padding: 0 4px;
  border-radius: 8px;
  background: rgba(184,134,11,0.10);
  border: 1px solid rgba(184,134,11,0.25);
  font-style: normal;
}
.notes-preview .pn-author {
  color: var(--ink-faint);
}
```

- [ ] **Step 3: Render the preview in `showCombat()`**

Find the existing `row.innerHTML = ...` block (around line 275). Just after
the closing backtick of the template literal, insert a step to add the
preview line. Find this exact code:

```js
    row.innerHTML = `
      <div class="row-main">
        <div class="init-num">${c.init}</div>
        <div>
          <div class="name-text">
            <span class="type-pip ${c.type}"></span>
            ${isActive ? '<span class="active-marker">▶</span>' : ''}
            ${c.name}
          </div>
          ${condsHtml}
        </div>
        <div class="right-col">
          ...
        </div>
      </div>
    `;
    list.appendChild(row);
```

Insert the preview render right BEFORE `list.appendChild(row);`:

```js
    // ── Notes preview (one-line, newest visible note) ─────────────
    const notes = Array.isArray(c.playerNotes) ? c.playerNotes : [];
    if (notes.length > 0) {
      // Newest first by createdAt
      const sorted = notes.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const top = sorted[0];
      const previewEl = document.createElement('div');
      previewEl.className = 'notes-preview';
      // Build the preview using textContent so note bodies can't inject HTML
      const icon = document.createElement('span'); icon.className = 'pn-icon'; icon.textContent = '📝';
      const count = document.createElement('span'); count.className = 'pn-count';
      count.textContent = '×' + notes.length;
      const body = document.createElement('span');
      const truncated = top.body.length > 60 ? top.body.slice(0, 57) + '…' : top.body;
      body.textContent = '"' + truncated + '"';
      const author = document.createElement('span');
      author.className = 'pn-author';
      author.textContent = '— ' + (top.authorName || '?');
      previewEl.appendChild(icon);
      previewEl.appendChild(count);
      previewEl.appendChild(body);
      previewEl.appendChild(author);
      // Append into the row-main's middle column (the name area)
      const middleCol = row.querySelector('.row-main > div:nth-child(2)');
      if (middleCol) middleCol.appendChild(previewEl);
    }

    list.appendChild(row);
```

- [ ] **Step 4: Smoke test**

Open the page in a browser with the live worker. The DM should have already
posted a smoke-test note in Phase 2 (Task 12 Step 6) — if it's still there,
the row for that combatant now shows the preview line. If you previously
deleted it, post a fresh note via curl (same recipe as Task 12 Step 6).

Visual check:
- Preview line under the name, single line, ellipsis if long.
- "×N" count chip is visible.
- Author name is dim/faint.
- No XSS: try `<script>alert(1)</script>` as a note body via curl; the
  raw `<script>` text shows as visible characters, no alert fires.

- [ ] **Step 5: Commit**

```bash
git add initiative-player.html
git commit -m "initiative-player: collapsed-row notes preview"
```

---

### Task 15: Expanded row — read-only notes list

Tap a row → it expands to show the full notes list. Only one row expanded
at a time.

**Files:**
- Modify: `initiative-player.html`

- [ ] **Step 1: Snapshot**

```bash
ts=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${ts}-initiative-notes-task-15"
cp initiative-player.html "backups/${ts}-initiative-notes-task-15/"
```

- [ ] **Step 2: Add expanded-row CSS**

Before `</style>`:

```css
/* ── Expanded row (notes panel) ── */
.row-expanded {
  display: none;
  padding: 10px 14px 14px;
  border-top: 1px solid var(--border);
  background: rgba(0,0,0,0.18);
}
.row.expanded .row-expanded { display: block; }
.row.expanded { cursor: default; }
.row:not(.expanded) { cursor: pointer; }

.notes-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.note-card {
  background: var(--surface2);
  border: 1px solid var(--border-light);
  border-left: 2px solid var(--gold-faint);
  border-radius: 3px;
  padding: 7px 10px;
  position: relative;
}
.note-card.is-mine { border-left-color: var(--pc-accent); }
.note-card.is-pending { opacity: 0.55; }
.note-body {
  color: var(--ink);
  font-size: 0.86rem;
  word-break: break-word;
  white-space: pre-wrap;
}
.note-meta {
  margin-top: 3px;
  display: flex; align-items: center; gap: 8px;
  font-family: 'Cinzel', serif;
  font-size: 0.6rem;
  letter-spacing: 0.08em;
  color: var(--ink-faint);
  text-transform: uppercase;
}
.note-meta .vis-chip {
  padding: 1px 6px; border-radius: 8px;
  border: 1px solid var(--border-light);
}
.note-meta .vis-chip.party   { color: var(--gold-light);  border-color: var(--gold-faint); }
.note-meta .vis-chip.private { color: #95d0d0; border-color: var(--lobby-accent); }
.note-meta .delete-btn {
  margin-left: auto;
  background: none; border: 0; color: var(--ink-faint);
  cursor: pointer; font-size: 0.9rem; padding: 0 4px;
}
.note-meta .delete-btn:hover { color: var(--red); }
.notes-empty {
  color: var(--ink-faint); font-style: italic; font-size: 0.8rem;
  padding: 4px 0;
}
```

- [ ] **Step 3: Add the expanded `<div>` to each row's HTML**

In `showCombat`, modify the `row.innerHTML` template to append a
`<div class="row-expanded">` after `</div>` (after `row-main`). The new
HTML inside the template literal (replace the closing backtick with the
following):

```js
    row.innerHTML = `
      <div class="row-main">
        <div class="init-num">${c.init}</div>
        <div>
          <div class="name-text">
            <span class="type-pip ${c.type}"></span>
            ${isActive ? '<span class="active-marker">▶</span>' : ''}
            ${c.name}
          </div>
          ${condsHtml}
        </div>
        <div class="right-col">
          <div class="hp-block">
            <div class="hp-label">${isPC ? 'HP' : 'CONDITION'}</div>
            <div class="hp-bar-wrap">
              <div class="hp-bar" style="width:${hpPct}%;background:${hpColor(hpPct)}"></div>
            </div>
            <div class="hp-num">${hpLabel(hpPct, c.type, c.hp, c.maxHp)}</div>
          </div>
          ${acHtml}
        </div>
      </div>
      <div class="row-expanded" data-combatant-id="${c.id}">
        <div class="notes-list"></div>
      </div>
    `;
```

(Note: the form goes in Task 16 — for now, list only.)

- [ ] **Step 4: Add module-level expand state + render helper**

Near the top of the existing `<script>` block (just below `let failCount = 0;`),
add:

```js
let expandedId = null;   // combatant.id currently expanded, or null

// Bind click to expand/collapse. Called from row creation in renderRow().
function bindRowClick(rowEl, combatantId) {
  rowEl.addEventListener('click', (e) => {
    // Ignore clicks inside the expanded area (form inputs, delete buttons)
    if (e.target.closest('.row-expanded')) return;
    expandedId = (expandedId === combatantId) ? null : combatantId;
    renderExpandedState();
  });
}

function renderExpandedState() {
  document.querySelectorAll('.row').forEach(r => {
    const id = r.dataset.combatantId;
    r.classList.toggle('expanded', id === expandedId);
  });
}

function renderNotesList(combatantId, notes, viewer) {
  // viewer = { role: 'player'|'anonymous', characterId? } (no DM here)
  const root = document.querySelector(`.row-expanded[data-combatant-id="${CSS.escape(combatantId)}"] .notes-list`);
  if (!root) return;
  root.innerHTML = '';
  if (!notes || notes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'notes-empty';
    empty.textContent = 'No notes yet.';
    root.appendChild(empty);
    return;
  }
  const sorted = notes.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  sorted.forEach(n => {
    const card = document.createElement('div');
    card.className = 'note-card' + (viewer.characterId && n.authorCharId === viewer.characterId ? ' is-mine' : '');
    if (n._pending) card.classList.add('is-pending');

    const body = document.createElement('div');
    body.className = 'note-body';
    body.textContent = n.body;   // textContent, never innerHTML
    card.appendChild(body);

    const meta = document.createElement('div');
    meta.className = 'note-meta';
    const vis = document.createElement('span');
    vis.className = 'vis-chip ' + n.visibility;
    vis.textContent = n.visibility;
    meta.appendChild(vis);
    const author = document.createElement('span');
    const isMine = viewer.characterId && n.authorCharId === viewer.characterId;
    author.textContent = (isMine ? 'you' : (n.authorName || '?')) + ' · ' + relTime(n.createdAt);
    meta.appendChild(author);

    if (InitiativeNotes.canDeleteNote(n,
        { role: 'player', characterId: viewer.characterId })) {
      const del = document.createElement('button');
      del.className = 'delete-btn';
      del.textContent = '×';
      del.title = 'Delete this note';
      del.onclick = (e) => { e.stopPropagation(); deleteNote(combatantId, n.id); };
      meta.appendChild(del);
    }

    card.appendChild(meta);
    root.appendChild(card);
  });
}

function relTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000)         return 'just now';
  if (diff < 3_600_000)      return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000)     return Math.floor(diff / 3_600_000) + 'h ago';
  const d = new Date(ms);
  return d.toLocaleDateString();
}

function deleteNote(combatantId, noteId) {
  // Implemented in Task 18.
  console.log('TODO delete', combatantId, noteId);
}
```

- [ ] **Step 5: Wire `bindRowClick` + `renderNotesList` into the existing render**

In `showCombat`, after `list.appendChild(row);` (still inside the
`s.combatants.forEach`), add:

```js
    row.dataset.combatantId = c.id;
    bindRowClick(row, c.id);

    const me = (window.Auth && Auth.playerCreds && Auth.playerCreds()) || null;
    const viewer = { role: 'player', characterId: me ? me.characterId : null };
    renderNotesList(c.id, c.playerNotes || [], viewer);
```

After the `s.combatants.forEach(...)` loop, restore expanded state:

```js
  renderExpandedState();
```

- [ ] **Step 6: Smoke test**

Reload the player page. Click a row that has notes — it should expand and
show the notes list. Click another row — first collapses, second expands.
Click the expanded row again — it collapses. Visual: cards with body,
visibility chip, author + time, and an "×" delete button on notes you
authored. Clicking "×" logs to console but doesn't yet delete (Task 18).

- [ ] **Step 7: Commit**

```bash
git add initiative-player.html
git commit -m "initiative-player: expandable rows + read-only notes list"
```

---

### Task 16: Add-note form (logged-in players)

Adds the "Add a note" textarea + visibility radios + Save button to the
bottom of each expanded panel. Anonymous viewers get a login banner instead
(Task 19).

**Files:**
- Modify: `initiative-player.html`

- [ ] **Step 1: Snapshot**

```bash
ts=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${ts}-initiative-notes-task-16"
cp initiative-player.html "backups/${ts}-initiative-notes-task-16/"
```

- [ ] **Step 2: Add form CSS** (before `</style>`)

```css
.add-note-form {
  display: flex; flex-direction: column; gap: 6px;
  padding-top: 8px;
  border-top: 1px dashed var(--border-light);
}
.add-note-form textarea {
  width: 100%;
  min-height: 50px;
  resize: vertical;
  background: var(--bg);
  color: var(--ink);
  border: 1px solid var(--border-light);
  border-radius: 3px;
  font-family: 'Crimson Text', Georgia, serif;
  font-size: 0.88rem;
  padding: 6px 8px;
}
.add-note-form textarea:focus { outline: none; border-color: var(--gold); }
.add-note-form .row-actions {
  display: flex; align-items: center; gap: 12px;
  font-family: 'Cinzel', serif; font-size: 0.7rem; letter-spacing: 0.06em;
  color: var(--ink-dim);
}
.add-note-form .vis-toggle { display: flex; gap: 10px; }
.add-note-form label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
.add-note-form input[type=radio] { accent-color: var(--gold); }
.add-note-form button {
  margin-left: auto;
  padding: 5px 14px;
  background: var(--gold-faint);
  color: var(--ink);
  border: 1px solid var(--gold);
  border-radius: 3px;
  font-family: 'Cinzel', serif;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  cursor: pointer;
}
.add-note-form button:hover { background: var(--gold); color: #1a1408; }
.add-note-form button:disabled { opacity: 0.4; cursor: not-allowed; }
.add-note-form .char-counter {
  font-size: 0.65rem; color: var(--ink-faint);
}
.add-note-form .char-counter.warn { color: var(--amber); }
.add-note-form .char-counter.over { color: var(--red); }
.add-note-form .form-error {
  color: var(--red); font-size: 0.78rem; font-style: italic;
  font-family: 'Crimson Text', serif;
}
.login-banner {
  padding: 8px 10px;
  background: rgba(58,96,96,0.18);
  border: 1px solid var(--lobby-accent);
  border-radius: 3px;
  color: var(--ink-dim);
  font-size: 0.82rem;
  font-style: italic;
  display: flex; align-items: center; gap: 10px;
}
.login-banner a {
  color: var(--gold-light);
  text-decoration: none;
  font-family: 'Cinzel', serif;
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  padding: 3px 10px;
  border: 1px solid var(--gold-faint);
  border-radius: 3px;
}
.login-banner a:hover { background: var(--gold-faint); color: var(--ink); }
```

- [ ] **Step 3: Render the form in `renderNotesList` for logged-in players**

Modify `renderNotesList` — after the loop that renders the existing notes,
add:

```js
  // Add-note form (only for logged-in players)
  if (viewer.characterId) {
    const form = document.createElement('div');
    form.className = 'add-note-form';
    const lastVis = localStorage.getItem('spire-initiative-note-vis') || 'party';
    form.innerHTML = `
      <textarea placeholder="Add a note about ${escapeAttr(getCombatantName(combatantId))}…"
                maxlength="${InitiativeNotes.MAX_NOTE_LENGTH + 50 /* allow overflow for counter */}"></textarea>
      <div class="row-actions">
        <div class="vis-toggle">
          <label><input type="radio" name="vis-${CSS.escape(combatantId)}" value="private" ${lastVis === 'private' ? 'checked' : ''}>JUST ME</label>
          <label><input type="radio" name="vis-${CSS.escape(combatantId)}" value="party"   ${lastVis === 'party'   ? 'checked' : ''}>PARTY</label>
        </div>
        <span class="char-counter">0/${InitiativeNotes.MAX_NOTE_LENGTH}</span>
        <button class="save-btn" disabled>Save</button>
      </div>
      <div class="form-error" style="display:none"></div>
    `;
    const textarea = form.querySelector('textarea');
    const counter  = form.querySelector('.char-counter');
    const saveBtn  = form.querySelector('.save-btn');
    const errEl    = form.querySelector('.form-error');

    textarea.addEventListener('input', () => {
      const len = textarea.value.length;
      counter.textContent = len + '/' + InitiativeNotes.MAX_NOTE_LENGTH;
      counter.classList.toggle('warn', len > 400 && len <= InitiativeNotes.MAX_NOTE_LENGTH);
      counter.classList.toggle('over', len > InitiativeNotes.MAX_NOTE_LENGTH);
      saveBtn.disabled = (textarea.value.trim().length === 0) || len > InitiativeNotes.MAX_NOTE_LENGTH;
    });

    saveBtn.addEventListener('click', () => {
      const vis = form.querySelector('input[type=radio]:checked').value;
      localStorage.setItem('spire-initiative-note-vis', vis);
      submitNote(combatantId, textarea.value, vis, { textarea, errEl, saveBtn });
    });

    root.parentElement.appendChild(form);  // appended outside .notes-list (sibling)
  }
```

Also add the small helpers `escapeAttr` and `getCombatantName` near
`relTime`:

```js
function escapeAttr(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}

function getCombatantName(id) {
  // Look up the latest snapshot's combatants. lastSnapshot stored in poll().
  const c = (lastSnapshot && lastSnapshot.combatants || []).find(x => x.id === id);
  return c ? c.name : 'this combatant';
}

let lastSnapshot = null;
function submitNote(/* impl in Task 17 */) {}
```

In `poll()` where you call `showCombat(data)`, also set `lastSnapshot = data;`
immediately before that line.

- [ ] **Step 4: Smoke test**

Reload the player page while logged in. Expand a row. The form appears
below the notes list with textarea, visibility radios, char counter,
and Save button. Counter updates as you type. Counter goes amber at
401+ chars and red at 501+. Save button is disabled when empty or over
500 chars. Clicking Save does nothing yet (Task 17). Anonymous viewers
should NOT see the form (it's gated on `viewer.characterId`); they get
no form at all in this task and a login banner in Task 19.

- [ ] **Step 5: Commit**

```bash
git add initiative-player.html
git commit -m "initiative-player: add-note form UI (submit wired in next task)"
```

---

### Task 17: Submit note with optimistic update + retry

**Files:**
- Modify: `initiative-player.html`

- [ ] **Step 1: Snapshot**

```bash
ts=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${ts}-initiative-notes-task-17"
cp initiative-player.html "backups/${ts}-initiative-notes-task-17/"
```

- [ ] **Step 2: Replace the stub `submitNote` with the real implementation**

```js
async function submitNote(combatantId, rawBody, visibility, els) {
  const body = (rawBody || '').toString();
  const v = InitiativeNotes.validateNote({ body, visibility });
  if (!v.ok) {
    els.errEl.style.display = 'block';
    els.errEl.textContent = v.error;
    return;
  }
  els.errEl.style.display = 'none';

  const me = (window.Auth && Auth.playerCreds && Auth.playerCreds()) || null;
  if (!me || !me.characterId || !me.code) {
    els.errEl.style.display = 'block';
    els.errEl.textContent = 'You are not logged in.';
    return;
  }

  // Optimistic local insert
  const tempNote = {
    id: 'temp_' + Math.random().toString(36).slice(2, 8),
    combatantId,
    authorCharId: me.characterId,
    authorName: me.name || '?',
    body, visibility,
    createdAt: Date.now(),
    _pending: true,
  };
  if (lastSnapshot && Array.isArray(lastSnapshot.combatants)) {
    const c = lastSnapshot.combatants.find(x => x.id === combatantId);
    if (c) {
      c.playerNotes = (c.playerNotes || []).concat([tempNote]);
      renderNotesList(combatantId, c.playerNotes, { role: 'player', characterId: me.characterId });
    }
  }
  els.saveBtn.disabled = true;
  const originalText = els.textarea.value;
  els.textarea.value = '';

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'initiative_note',
        characterId: me.characterId,
        code: me.code,
        combatantId,
        body,
        visibility,
      }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || ('HTTP ' + res.status));
    }
    // Success: the next poll tick will replace the pending temp note
    // with the server-issued one. No further action needed here.
  } catch (e) {
    // Roll back optimistic insert
    if (lastSnapshot && Array.isArray(lastSnapshot.combatants)) {
      const c = lastSnapshot.combatants.find(x => x.id === combatantId);
      if (c && Array.isArray(c.playerNotes)) {
        c.playerNotes = c.playerNotes.filter(n => n.id !== tempNote.id);
        renderNotesList(combatantId, c.playerNotes, { role: 'player', characterId: me.characterId });
      }
    }
    els.errEl.style.display = 'block';
    els.errEl.textContent = 'Couldn\'t save — ' + (e.message || 'try again') + '.';
    els.textarea.value = originalText;  // restore the user's text
    els.saveBtn.disabled = false;
  }
}
```

- [ ] **Step 3: Smoke test**

Reload page (logged in). Expand a row. Type a note, hit Save.
- The note appears immediately in the list with the "is-pending" faded look.
- Within ~2.5s (one poll tick), the temp note disappears and is replaced
  by the server-issued one (with the real `n_…` id and authoritative
  `createdAt`).
- Open another browser as a different player (or anonymous) and confirm
  the visibility rules: a `private` note is invisible to others; a `party`
  note shows up.
- Force a failure: temporarily kill the worker URL by editing `WORKER_URL`
  in DevTools console to a broken value, hit Save. The pending note rolls
  back, the textarea text is restored, an inline error shows.

- [ ] **Step 4: Commit**

```bash
git add initiative-player.html
git commit -m "initiative-player: submit note POST with optimistic insert + rollback"
```

---

### Task 18: Delete own note

**Files:**
- Modify: `initiative-player.html`

- [ ] **Step 1: Snapshot**

```bash
ts=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${ts}-initiative-notes-task-18"
cp initiative-player.html "backups/${ts}-initiative-notes-task-18/"
```

- [ ] **Step 2: Replace the stub `deleteNote`**

```js
async function deleteNote(combatantId, noteId) {
  const me = (window.Auth && Auth.playerCreds && Auth.playerCreds()) || null;
  if (!me || !me.characterId || !me.code) return;

  // Optimistic local remove
  let removedFromSnapshot = null;
  if (lastSnapshot && Array.isArray(lastSnapshot.combatants)) {
    const c = lastSnapshot.combatants.find(x => x.id === combatantId);
    if (c && Array.isArray(c.playerNotes)) {
      removedFromSnapshot = c.playerNotes.find(n => n.id === noteId);
      c.playerNotes = c.playerNotes.filter(n => n.id !== noteId);
      renderNotesList(combatantId, c.playerNotes, { role: 'player', characterId: me.characterId });
    }
  }

  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'initiative_note_delete',
        characterId: me.characterId,
        code: me.code,
        combatantId, noteId,
      }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || ('HTTP ' + res.status));
    }
  } catch (e) {
    // Roll back: re-insert the note
    if (removedFromSnapshot && lastSnapshot && Array.isArray(lastSnapshot.combatants)) {
      const c = lastSnapshot.combatants.find(x => x.id === combatantId);
      if (c) {
        c.playerNotes = (c.playerNotes || []).concat([removedFromSnapshot]);
        renderNotesList(combatantId, c.playerNotes, { role: 'player', characterId: me.characterId });
      }
    }
    alert('Couldn\'t delete: ' + (e.message || 'try again'));
  }
}
```

- [ ] **Step 3: Smoke test**

Reload page, expand a row with one of your own notes, click the "×".
- Note disappears immediately.
- Within ~2.5s the poll confirms (no visible change since the delete already
  happened).
- Verify with curl: `GET ?type=initiative_state...` — the note is absent.
- Try clicking "×" on someone else's note: the button shouldn't exist (per
  `canDeleteNote` gate in `renderNotesList`).

- [ ] **Step 4: Commit**

```bash
git add initiative-player.html
git commit -m "initiative-player: delete own note with optimistic rollback"
```

---

### Task 19: In-page login form for anonymous viewers

Per spec §5.1, anonymous viewers get an in-page login (not a redirect to
home.html — that page doesn't honor a `returnTo` query param). The form
reuses the existing `Auth.characterList()` + `Auth.playerLogin()` API; no
changes to `auth.js`.

**Files:**
- Modify: `initiative-player.html`

- [ ] **Step 1: Snapshot**

```bash
ts=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${ts}-initiative-notes-task-19"
cp initiative-player.html "backups/${ts}-initiative-notes-task-19/"
```

- [ ] **Step 2: Extend the login-banner CSS** (append to the existing `.login-banner` rules)

```css
.login-banner select,
.login-banner input[type=text] {
  background: var(--bg);
  color: var(--ink);
  border: 1px solid var(--border-light);
  border-radius: 3px;
  padding: 4px 6px;
  font-family: 'Crimson Text', Georgia, serif;
  font-size: 0.85rem;
}
.login-banner select { min-width: 160px; }
.login-banner button.login-trigger,
.login-banner button.login-submit {
  background: var(--gold-faint);
  color: var(--ink);
  border: 1px solid var(--gold);
  border-radius: 3px;
  font-family: 'Cinzel', serif;
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  padding: 4px 12px;
  cursor: pointer;
  text-decoration: none;
}
.login-banner button.login-trigger:hover,
.login-banner button.login-submit:hover {
  background: var(--gold); color: #1a1408;
}
.login-banner .login-error {
  color: var(--red);
  font-size: 0.8rem;
  font-style: italic;
  margin-left: 4px;
}
```

- [ ] **Step 3: Add `refreshOnce` helper** (insert near `poll` in the inline `<script>`)

This lets the post-login UI update immediately without spawning a parallel
poll loop.

```js
async function refreshOnce() {
  try {
    const res = await fetch(buildStateUrl(), { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data && typeof data.mode !== 'undefined') {
      lastSnapshot = data;
      if (data.mode === 'lobby') showLobby(); else showCombat(data);
    }
  } catch {}
}
```

- [ ] **Step 4: Add an `else` to the form gate in `renderNotesList`**

In `renderNotesList`, find the existing `if (viewer.characterId) { ... }`
block (added in Task 16). It currently has no `else`. Add this `else`:

```js
  if (viewer.characterId) {
    // (unchanged form-render code from Task 16)
  } else {
    // Anonymous: show login banner. Two-state: trigger button → inline form.
    const banner = document.createElement('div');
    banner.className = 'login-banner';
    banner.innerHTML = `
      <span>Log in as your character to add notes.</span>
      <button class="login-trigger" type="button">Log in</button>
    `;
    banner.querySelector('.login-trigger').addEventListener('click',
      (e) => { e.stopPropagation(); openInlineLogin(banner); });
    root.parentElement.appendChild(banner);
  }
```

- [ ] **Step 5: Add the `openInlineLogin` helper** (insert below `refreshOnce`)

```js
async function openInlineLogin(bannerEl) {
  // Fetch the public sanitized character list (works without auth)
  let chars = [];
  try { chars = await Auth.characterList(); } catch { chars = []; }
  if (!Array.isArray(chars)) chars = [];

  bannerEl.innerHTML = `
    <select class="login-char-sel">
      <option value="">— pick a character —</option>
      ${chars.map(c => `<option value="${escapeAttr(c.id)}">${escapeAttr(c.name)}</option>`).join('')}
    </select>
    <input class="login-code" type="text" maxlength="6" placeholder="Code" autocapitalize="characters">
    <button class="login-submit" type="button">Log in</button>
    <span class="login-error" style="display:none"></span>
  `;
  const select = bannerEl.querySelector('.login-char-sel');
  const codeIn = bannerEl.querySelector('.login-code');
  const submit = bannerEl.querySelector('.login-submit');
  const errEl  = bannerEl.querySelector('.login-error');

  // Prevent row-expand click swallowing form interactions
  [select, codeIn, submit].forEach(el =>
    el.addEventListener('click', (e) => e.stopPropagation()));

  submit.addEventListener('click', async () => {
    errEl.style.display = 'none';
    if (!select.value) { errEl.style.display = 'inline'; errEl.textContent = 'Pick a character.'; return; }
    if (!codeIn.value) { errEl.style.display = 'inline'; errEl.textContent = 'Enter your code.'; return; }
    submit.disabled = true;
    const r = await Auth.playerLogin(select.value, codeIn.value);
    if (!r.ok) {
      errEl.style.display = 'inline';
      errEl.textContent = r.error || 'Login failed.';
      submit.disabled = false;
      return;
    }
    // Logged in. Refresh data once; on next render the banner becomes the form.
    await refreshOnce();
  });
}
```

- [ ] **Step 6: Smoke test**

In a browser with no character login, open the player page (run
`localStorage.removeItem('spire-auth')` in DevTools to clear). Expand a
row with notes.
- See the "Log in as your character to add notes. [Log in]" banner.
- Click "Log in" → banner replaced with character dropdown, code input,
  and a submit button.
- Pick a character, enter a wrong code → inline error appears.
- Enter the correct code → click submit. Within ~500ms the row re-renders:
  the banner is gone, the add-note form is present, and any of your own
  private notes you couldn't see anonymously now appear.
- Network tab: subsequent polls include `&characterId=…&code=…`.

- [ ] **Step 7: Commit**

```bash
git add initiative-player.html
git commit -m "initiative-player: in-page login form for anonymous viewers"
```

---

### Task 20: Phase 3 end-to-end smoke test

No code changes; comprehensive manual run-through. Document any defects
found and either fix immediately (separate commits) or open follow-ups.

- [ ] **Step 1: Two-player live test**

Open two browser windows:
- Window A: logged in as Character 1 (e.g., "Lyra")
- Window B: logged in as Character 2 (e.g., "Garruk")
- Window C (incognito): anonymous

Have the DM set up a combat with at least one enemy combatant.

- [ ] **Step 2: Visibility checks**

- In A, post a `private` note on the goblin: "Owes me 20gp".
- In A, post a `party` note on the goblin: "Fire resistant".
- Within one poll tick:
  - A sees both notes (own private + own party).
  - B sees only "Fire resistant" (party only).
  - C sees only "Fire resistant" (party only).

- [ ] **Step 3: DM-write doesn't wipe notes**

While the notes from Step 2 are live, have the DM open `initiative-dm.html`
and adjust the goblin's HP (e.g. "Heal 5"). Push the change.
- All three browsers re-poll. Notes are STILL there.

- [ ] **Step 4: Cross-author delete denial**

In B, expand the goblin's row. There should be no "×" button on
"Fire resistant" (B is not its author). Try to delete via curl with B's
creds — the worker should return 403.

- [ ] **Step 5: Note length + counter behavior**

In A, type a 501-char note. Counter goes red. Save button is disabled.
Try posting a 1-char note containing only whitespace. Save button stays
disabled (it requires `trim().length > 0`).

- [ ] **Step 6: Optimistic insert + rollback**

In A, type a note. In DevTools, change `WORKER_URL` to a bogus URL. Save.
- Note appears pending, then disappears with an inline error.
- textarea content is restored.

- [ ] **Step 7: Lobby reset clears notes**

DM ends the encounter (clear or "End combat" → mode 'lobby'). Players see
the lobby screen. When the DM starts a new combat, all previous notes are
gone (combat-scoped lifetime).

- [ ] **Step 8: No code, no commit (or commit any defect-fix changes individually)**

---

## Phase 4 — DM UI

### Task 21: Read-only "Player notes" section on DM combatant cards

**Files:**
- Backup: `initiative-dm.html`
- Modify: `initiative-dm.html`

- [ ] **Step 1: Snapshot**

```bash
ts=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${ts}-initiative-notes-task-21"
cp initiative-dm.html "backups/${ts}-initiative-notes-task-21/"
```

- [ ] **Step 2: Add the DM-side CSS** (in the existing `<style>` block, near the existing `.notes-input` definition around line 246)

```css
/* ── Player notes (read-only, on combatant card) ── */
.player-notes-section {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--border-light);
}
.player-notes-section .pn-header {
  font-family: 'Cinzel', serif;
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  color: var(--gold-light);
  text-transform: uppercase;
  margin-bottom: 5px;
}
.player-notes-section .pn-item {
  font-size: 0.82rem;
  color: var(--ink);
  padding: 3px 0;
  display: flex; gap: 6px; align-items: baseline;
}
.player-notes-section .pn-item .pn-body { flex: 1; word-break: break-word; }
.player-notes-section .pn-item .pn-meta {
  font-family: 'Cinzel', serif;
  font-size: 0.58rem;
  letter-spacing: 0.06em;
  color: var(--ink-faint);
  text-transform: uppercase;
  white-space: nowrap;
}
.player-notes-section .pn-item .pn-vis {
  padding: 0 5px;
  border-radius: 7px;
  border: 1px solid var(--border-light);
}
.player-notes-section .pn-item .pn-vis.party   { color: var(--gold-light);  border-color: var(--gold-faint); }
.player-notes-section .pn-item .pn-vis.private { color: #95d0d0; border-color: var(--lobby-accent); }
```

- [ ] **Step 3: Load `initiative-notes.js` in the DM page** (in the `<head>`, alongside `auth.js`)

Find `<script src="auth.js"></script>` (search for it; should be in the
script-tag region near the bottom of the file, but check). Add directly
after:

```html
<script src="initiative-notes.js"></script>
```

- [ ] **Step 4: Render the section in the existing combatant-card template**

In `initiative-dm.html`, find the existing expanded panel block around
line 1993–1996:

```html
        <div>
          <span class="exp-label">DM NOTES (NOT SHOWN TO PLAYERS)</span>
          <textarea class="notes-input" onclick="event.stopPropagation()" onchange="setNotes(${c.id},this.value)" placeholder="Secret notes…">${c.notes}</textarea>
        </div>
```

Insert immediately AFTER that `</div>`, BEFORE the `${c.bestiaryId ? ...` line:

```html
        ${(() => {
          const notes = Array.isArray(c.playerNotes) ? c.playerNotes : [];
          if (notes.length === 0) return '';
          const sorted = notes.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          const lines = sorted.map(n => {
            const safeBody = escapeHTML(n.body || '');
            const author   = escapeHTML(n.authorName || '?');
            const vis      = n.visibility === 'private' ? 'private' : 'party';
            const rel      = relTimeDM(n.createdAt);
            return `
              <div class="pn-item">
                <span class="pn-body">"${safeBody}"</span>
                <span class="pn-meta">— ${author}</span>
                <span class="pn-meta pn-vis ${vis}">${vis}</span>
                <span class="pn-meta">${rel}</span>
              </div>
            `;
          }).join('');
          return `
            <div class="player-notes-section">
              <div class="pn-header">📝 Player notes (${notes.length})</div>
              ${lines}
            </div>
          `;
        })()}
```

- [ ] **Step 5: Add the helpers `escapeHTML` and `relTimeDM` in the page's `<script>` block**

Add near the top of the existing inline `<script>` (search for an
existing `function uid()` or similar; insert beside that):

```js
function escapeHTML(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}

function relTimeDM(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000)         return 'just now';
  if (diff < 3_600_000)      return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000)     return Math.floor(diff / 3_600_000) + 'h ago';
  return new Date(ms).toLocaleDateString();
}
```

- [ ] **Step 6: Smoke test (DM side)**

Open `initiative-dm.html` as DM in a fresh browser. The current
`initiative_state` in KV should have at least one combatant with player
notes from Phase 3 testing — if not, post a note via curl. Expand the
combatant card.
- "📝 Player notes (N)" section appears below the "DM NOTES" textarea.
- All notes shown, including PRIVATE ones (DM sees everything).
- Author name + visibility chip + relative time displayed.
- XSS check: post a note via curl with body `<img src=x onerror=alert(1)>`,
  reload the DM page, expand the card. No alert; the literal text shows.
- Card without any player notes: the section is absent (no empty header).

- [ ] **Step 7: Commit**

```bash
git add initiative-dm.html
git commit -m "initiative-dm: read-only Player notes section on combatant cards"
```

---

## Phase 5 — Wrap-up

### Task 22: Update CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add a new entry at the top of the Unreleased section**

Open `CHANGELOG.md`. Find the "Unreleased" heading (or equivalent — match
the existing style of the file). Add at the top of its content:

```markdown
- **Initiative tracker: player notes.** Players can attach short
  combat-scoped notes to any combatant in `initiative-player.html` —
  themselves, party members, enemies. Notes are private (just author) or
  party-visible (all logged-in players + DM). The DM sees everything
  read-only in the expanded combatant card on `initiative-dm.html`.
  Notes die with the encounter (live entirely inside `initiative_state`).
- **Initiative tracker: defense-in-depth filter on the player GET path.**
  The DM tracker already strips `notes` (DM-only string) and `hidden`
  combatants client-side before POSTing to the worker, so KV's
  `initiative_state` value has never actually contained them in practice.
  The new worker-side filter (`filterInitiativeState`) enforces the same
  rules server-side regardless of what lands in KV — so a future bug or
  malicious DM client can't accidentally leak the fields.
- **Worker change requires manual redeploy.** New endpoints
  `initiative_note` + `initiative_note_delete`; filter pass on GET
  `initiative_state`; notes-preservation merge step on the existing DM
  `initiative_state` POST handler (prevents DM HP/condition writes from
  clobbering player notes).
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "CHANGELOG: initiative player notes + payload-leak fixes"
```

---

### Task 23: Final cross-page integration smoke test

No code changes. Tighter run-through than Task 20, covering all four
pages + the worker simultaneously.

- [ ] **Step 1: Verify worker is on latest**

```bash
curl -s 'https://dnd-perk-webhook.jacobgiff.workers.dev/?type=initiative_state' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); \
  print('combatants:', len(d.get('combatants',[]))); \
  print('any.notes:', any('notes' in c for c in d.get('combatants',[]))); \
  print('any.hidden:', any(c.get('hidden') for c in d.get('combatants',[])))"
```

Expected: `any.notes: False`, `any.hidden: False`. If either is True,
the worker isn't on the new code — re-deploy.

- [ ] **Step 2: DM-side notes panel renders on `initiative-dm.html`**

DM opens an existing combatant card with player notes (post a fresh one
via curl if needed). The "📝 Player notes (N)" section is visible with
author/visibility/time metadata, including any private notes.

- [ ] **Step 3: Player-side preview renders on `initiative-player.html`**

A logged-in player sees the one-line preview on collapsed rows for any
combatant with ≥1 visible note. Anonymous viewer sees the same except
only for party-visible notes.

- [ ] **Step 4: Expanded panel + add + delete cycle works end-to-end**

Logged-in player: expand → add note → see it pending → see server-issued
version after one poll → delete it → see it gone. All within ~5 seconds.

- [ ] **Step 5: DM HP edit doesn't wipe notes (regression test for §4.5)**

While at least one note exists, DM does a non-trivial state change
(HP, condition, init re-roll, kill, etc.). Player browser re-polls. Notes
still there.

- [ ] **Step 6: Lobby reset clears notes**

DM ends combat → mode goes to 'lobby'. Player sees lobby screen. DM starts
a new combat. All combatants from the new encounter have empty notes.

- [ ] **Step 7: If all of the above pass, ready to PR**

Optionally push the branch and open a PR (see `CLAUDE.md` for the
no-`gh` workflow — push, then open the compare URL in a browser):

```bash
git push -u origin feature/initiative-player-notes
echo "Compare URL: https://github.com/Gifftd/the-spire/compare/main...feature/initiative-player-notes?expand=1"
```

---

## Done

Feature complete when Task 23 passes. The worker is deployed; both
initiative pages have the new UI; the shared module and its 27 tests
are in tree; CHANGELOG is up to date. The two pre-existing payload
leaks (DM `notes` string and hidden enemies) are closed as a free
side effect.
