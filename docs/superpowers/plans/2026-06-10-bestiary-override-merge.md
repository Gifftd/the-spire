# Bestiary Override Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bestiary read-path concat with a merge layer so Crucible-written override records overlay their imported base by name+source, and the same logic applies in the Crucible, War Table, and Menagerie. The DM stops seeing two "Goblin" entries after saving an override.

**Architecture:** A new shared file `bestiary-merge.js` exports one pure function — `BestiaryMerge.mergeBestiaries(imported, custom)`. Three pages load it via a `<script src>` tag and replace their existing concat with one call to the helper. No worker changes, no KV schema changes.

**Tech Stack:** Plain HTML/CSS/JS (no build step, no framework). Tests run via the existing vanilla-HTML harness pattern.

**Spec:** `docs/superpowers/specs/2026-06-10-bestiary-override-merge-design.md`

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `bestiary-merge.js` | NEW | Pure-function module: `mergeBestiaries`, `isOverrideRecord`, `recordKey`, `OVERRIDE_FIELDS`. IIFE + dual export (CommonJS / window). |
| `tests/bestiary-merge.test.html` | NEW | Standalone test page with inline harness. ~13 fixture-based assertions. |
| `crucible-dm.html` | MODIFY | Add `<script src>` tag; replace `loadBestiary`'s two for-loops with one merge call. |
| `initiative-dm.html` | MODIFY | Add `<script src>` tag; replace `_BP.monsters = arr.concat(...)` line with merge call. |
| `bestiary-dm.html` | MODIFY | Add `<script src>` tag; replace `allMonsters()` function body with merge call. |
| `CHANGELOG.md` | MODIFY | One entry summarizing the read-path change + manual UI checklist. |

**No new worker endpoints. No KV schema changes. Backward-compatible with existing override records.**

---

## Phase 1 — Shared module + tests

### Task 1: Create `bestiary-merge.js` skeleton + isOverrideRecord + recordKey + arrayOf + test harness

**Files:**
- Create: `bestiary-merge.js`
- Create: `tests/bestiary-merge.test.html`

- [ ] **Step 1: Write `bestiary-merge.js` with helpers (no mergeBestiaries yet)**

```js
// ═══════════════════════════════════════════════════════════════════════
//  bestiary-merge.js
//  Pure functions for merging bestiary + bestiary_custom into one
//  unified monster list. Override records (with `overriddenAt`) overlay
//  their imported base by name+source. Homebrew records pass through.
//  No DOM access. Loaded by crucible-dm.html, initiative-dm.html,
//  bestiary-dm.html, and tests/bestiary-merge.test.html.
// ═══════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  // Fields that override records can supply. Non-null values overlay the
  // matching field on the imported base; null/undefined falls through.
  const OVERRIDE_FIELDS = ['parsedActions', 'regeneration', 'roleOverride'];

  // A record is an override (vs. homebrew) iff it has an `overriddenAt` stamp.
  function isOverrideRecord(m) {
    return !!(m && m.overriddenAt);
  }

  // Stable key for matching imported and override records.
  // Imported records use `m.source` (scrape pipeline convention);
  // override records use `m._source` (Crucible convention).
  function recordKey(m) {
    if (!m) return '|';
    const name = m.name || '';
    const src  = m._source || m.source || '';
    return name + '|' + src;
  }

  // Tolerate both bare-array and envelope-{monsters:[...]} shapes.
  function arrayOf(v) {
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.monsters)) return v.monsters;
    return [];
  }

  // ─────────── Public exports ───────────
  const BestiaryMerge = {
    OVERRIDE_FIELDS,
    isOverrideRecord,
    recordKey,
    arrayOf,
    // mergeBestiaries is added in Task 2.
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BestiaryMerge;
  else root.BestiaryMerge = BestiaryMerge;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2: Write `tests/bestiary-merge.test.html` with inline harness + 5 helper assertions**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Bestiary-merge tests</title>
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
<h1>Bestiary-merge tests</h1>
<button onclick="runAll()">Run tests</button>
<div id="results"></div>
<div id="summary"></div>

<script src="../bestiary-merge.js"></script>
<script>
const TESTS = [];
function test(name, fn) { TESTS.push({ name, fn }); }
function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((label || '') +
    '\n   expected: ' + e + '\n     actual: ' + a);
}
function assertTrue(cond, label) { if (!cond) throw new Error(label || 'expected true'); }
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
// ─────── Task 1: helper API ───────
test('isOverrideRecord: record with overriddenAt → true', () => {
  assertEq(BestiaryMerge.isOverrideRecord({ overriddenAt:'2026-06-10' }), true);
});
test('isOverrideRecord: full statblock (no overriddenAt) → false', () => {
  assertEq(BestiaryMerge.isOverrideRecord({ hp:30, ac:14, name:'Goblin' }), false);
});
test('isOverrideRecord: null/undefined → false', () => {
  assertEq(BestiaryMerge.isOverrideRecord(null), false);
  assertEq(BestiaryMerge.isOverrideRecord(undefined), false);
});
test('recordKey: imported (source) and override (_source) match', () => {
  const imp = { name:'Goblin', source:'mm-2024' };
  const ov  = { name:'Goblin', _source:'mm-2024' };
  assertEq(BestiaryMerge.recordKey(imp), BestiaryMerge.recordKey(ov));
  assertEq(BestiaryMerge.recordKey(imp), 'Goblin|mm-2024');
});
test('arrayOf: tolerates bare array, envelope, null', () => {
  assertEq(BestiaryMerge.arrayOf([1,2,3]), [1,2,3]);
  assertEq(BestiaryMerge.arrayOf({ monsters:[1,2] }), [1,2]);
  assertEq(BestiaryMerge.arrayOf(null), []);
  assertEq(BestiaryMerge.arrayOf({}), []);
  assertEq(BestiaryMerge.arrayOf(undefined), []);
});
</script>
</body>
</html>
```

- [ ] **Step 3: Verify by opening `tests/bestiary-merge.test.html` in a browser**

Click Run. Expected: 5 passed, 0 failed.

- [ ] **Step 4: Commit**

```bash
git add bestiary-merge.js tests/bestiary-merge.test.html
git commit -m "bestiary-merge: scaffold module + isOverrideRecord/recordKey/arrayOf helpers"
```

---

### Task 2: Implement `mergeBestiaries` — main path

**Files:**
- Modify: `bestiary-merge.js`
- Modify: `tests/bestiary-merge.test.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-bestiary-merge-task2"
cp bestiary-merge.js tests/bestiary-merge.test.html "backups/${TS}-bestiary-merge-task2/"
```

- [ ] **Step 2: Append failing tests inside the last `<script>` block of `tests/bestiary-merge.test.html`**

```js
// ─────── Task 2: main merge paths ───────
test('mergeBestiaries: empty inputs → []', () => {
  assertEq(BestiaryMerge.mergeBestiaries([], []), []);
  assertEq(BestiaryMerge.mergeBestiaries(null, null), []);
  assertEq(BestiaryMerge.mergeBestiaries(undefined, undefined), []);
});
test('mergeBestiaries: imported only → passes through, _source normalized', () => {
  const imp = [
    { name:'Goblin', source:'mm-2024', hp:7, ac:15 },
    { name:'Orc',    source:'mm-2024', hp:15, ac:13 },
  ];
  const r = BestiaryMerge.mergeBestiaries(imp, []);
  assertEq(r.length, 2);
  assertEq(r[0].name, 'Goblin');
  assertEq(r[0]._source, 'mm-2024');
  assertEq(r[0].hp, 7);                       // imported fields pass through
  assertEq(r[1]._source, 'mm-2024');
});
test('mergeBestiaries: homebrew only → tagged _custom', () => {
  const cust = [
    { name:'Hag Lord', _source:'custom', hp:120, ac:17, actions:[] },
  ];
  const r = BestiaryMerge.mergeBestiaries([], cust);
  assertEq(r.length, 1);
  assertEq(r[0].name, 'Hag Lord');
  assertEq(r[0]._custom, true);
  assertEq(r[0].hp, 120);
});
test('mergeBestiaries: override matches imported → overlaid', () => {
  const imp = [
    { name:'Owlbear', source:'mm-2024', hp:59, ac:13,
      parsedActions:[ { sourceActionName:'Beak', kind:'attack', toHit:6 } ] },
  ];
  const cust = [
    { name:'Owlbear', _source:'mm-2024',
      roleOverride:'brute',
      parsedActions:[ { sourceActionName:'Beak', kind:'attack', toHit:99 } ],
      overriddenAt:'2026-06-10T12:00:00Z' },
  ];
  const r = BestiaryMerge.mergeBestiaries(imp, cust);
  assertEq(r.length, 1);                       // one merged entry, not two
  assertEq(r[0].name, 'Owlbear');
  assertEq(r[0].hp, 59);                       // imported field survives
  assertEq(r[0].ac, 13);                       // imported field survives
  assertEq(r[0].roleOverride, 'brute');        // override field applied
  assertEq(r[0].parsedActions[0].toHit, 99);   // override parsedActions wins
  assertEq(r[0]._overriddenAt, '2026-06-10T12:00:00Z');
});
```

- [ ] **Step 3: Run tests; verify the 4 new ones fail**

Open `tests/bestiary-merge.test.html`, click Run. Expected: 5 existing pass; 4 new fail with `Crucible.mergeBestiaries is not a function` (or similar).

- [ ] **Step 4: Add `mergeBestiaries` to `bestiary-merge.js`**

In `bestiary-merge.js`, find the `// mergeBestiaries is added in Task 2.` comment inside the exports block. Above that block, add the function:

```js
  // Merge imported + custom into a unified monster list.
  // - Override records (overriddenAt set) overlay their imported base by
  //   name+source. Non-null override fields win; nulls/undefined fall through.
  // - Homebrew records (no overriddenAt) pass through tagged `_custom:true`.
  // - Orphan overrides (no matching imported base) are appended in Task 3.
  function mergeBestiaries(imported, custom) {
    const importedArr = arrayOf(imported);
    const customArr   = arrayOf(custom);

    // Index override records by match key; collect homebrew separately.
    const overrideIdx = new Map();
    const homebrew = [];
    for (const m of customArr) {
      if (isOverrideRecord(m)) {
        overrideIdx.set(recordKey(m), m);
      } else {
        homebrew.push({ ...m, _source: m._source || m.source || 'custom', _custom: true });
      }
    }

    // Walk imported, overlaying overrides where the key matches.
    const out = [];
    for (const m of importedArr) {
      const key = recordKey(m);
      const ov  = overrideIdx.get(key);
      const merged = { ...m, _source: m._source || m.source || '' };
      if (ov) {
        for (const field of OVERRIDE_FIELDS) {
          if (ov[field] !== undefined && ov[field] !== null) merged[field] = ov[field];
        }
        merged._overriddenAt = ov.overriddenAt;
      }
      out.push(merged);
    }

    // Homebrew appended last. Orphan overrides handled in Task 3.
    out.push(...homebrew);
    return out;
  }
```

Then replace the exports block:

```js
  const BestiaryMerge = {
    OVERRIDE_FIELDS,
    isOverrideRecord,
    recordKey,
    arrayOf,
    mergeBestiaries,
  };
```

- [ ] **Step 5: Re-run tests; verify all 9 pass**

- [ ] **Step 6: Commit**

```bash
git add bestiary-merge.js tests/bestiary-merge.test.html
git commit -m "bestiary-merge: mergeBestiaries — imported / homebrew / override overlay"
```

---

### Task 3: Add orphan + partial + null-field-protection + cross-source coverage

**Files:**
- Modify: `bestiary-merge.js`
- Modify: `tests/bestiary-merge.test.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-bestiary-merge-task3"
cp bestiary-merge.js tests/bestiary-merge.test.html "backups/${TS}-bestiary-merge-task3/"
```

- [ ] **Step 2: Append failing tests inside the last `<script>` block of `tests/bestiary-merge.test.html`**

```js
// ─────── Task 3: edge cases ───────
test('mergeBestiaries: orphan override → appended with _orphanOverride flag', () => {
  const imp = [
    { name:'Goblin', source:'mm-2024', hp:7, ac:15 },
  ];
  const cust = [
    { name:'Doesnotexist', _source:'mm-2024',
      roleOverride:'brute',
      overriddenAt:'2026-06-10T12:00:00Z' },
  ];
  const r = BestiaryMerge.mergeBestiaries(imp, cust);
  assertEq(r.length, 2);                                // goblin + orphan
  const orphan = r.find(x => x.name === 'Doesnotexist');
  assertEq(orphan._orphanOverride, true);
  assertEq(orphan._custom, true);
  assertEq(orphan.roleOverride, 'brute');
});
test('mergeBestiaries: partial override (roleOverride only) → other fields fall through', () => {
  const imp = [
    { name:'Owlbear', source:'mm-2024', hp:59, ac:13,
      parsedActions:[ { sourceActionName:'Beak', toHit:6 } ],
      regeneration:{ amount:5, suppressedBy:[], minHpToRegen:1 } },
  ];
  const cust = [
    { name:'Owlbear', _source:'mm-2024',
      roleOverride:'brute',
      // no parsedActions, no regeneration
      overriddenAt:'2026-06-10T12:00:00Z' },
  ];
  const r = BestiaryMerge.mergeBestiaries(imp, cust);
  assertEq(r[0].roleOverride, 'brute');                          // applied
  assertEq(r[0].parsedActions[0].toHit, 6);                       // base survives
  assertEq(r[0].regeneration.amount, 5);                          // base survives
});
test('mergeBestiaries: explicit null override field → base survives', () => {
  const imp = [
    { name:'Owlbear', source:'mm-2024', hp:59,
      parsedActions:[ { sourceActionName:'Beak', toHit:6 } ] },
  ];
  const cust = [
    { name:'Owlbear', _source:'mm-2024',
      parsedActions: null,                                          // explicit null
      roleOverride: 'brute',
      overriddenAt:'2026-06-10T12:00:00Z' },
  ];
  const r = BestiaryMerge.mergeBestiaries(imp, cust);
  assertEq(r[0].roleOverride, 'brute');                            // applied
  assertEq(r[0].parsedActions[0].toHit, 6);                        // base survives — null didn't clobber
});
test('mergeBestiaries: same name across sources → distinct entries, no cross-leak', () => {
  const imp = [
    { name:'Goblin', source:'mm-2024', hp:7, ac:15 },
    { name:'Goblin', source:'fm-v1',   hp:9, ac:14 },
  ];
  const cust = [
    { name:'Goblin', _source:'mm-2024',
      roleOverride:'brute',
      overriddenAt:'2026-06-10T12:00:00Z' },
  ];
  const r = BestiaryMerge.mergeBestiaries(imp, cust);
  assertEq(r.length, 2);
  const mm = r.find(x => x._source === 'mm-2024');
  const fm = r.find(x => x._source === 'fm-v1');
  assertEq(mm.roleOverride, 'brute');                              // override hit MM
  assertTrue(!fm.roleOverride, 'FM Goblin should NOT have brute override');
});
test('mergeBestiaries: mixed everything — record counts add up', () => {
  const imp = Array.from({length:10}, (_, i) => ({
    name:'M'+i, source:'mm-2024', hp:10+i, ac:13 }));
  const homebrew = Array.from({length:3}, (_, i) => ({
    name:'H'+i, _source:'custom', hp:20, ac:15, actions:[] }));
  const overrides = [0,1,2,3].map(i => ({
    name:'M'+i, _source:'mm-2024',
    roleOverride:'brute',
    overriddenAt:'2026-06-10T12:00:00Z' }));
  const orphan = { name:'Ghost', _source:'mm-2024',
                   roleOverride:'brute',
                   overriddenAt:'2026-06-10T12:00:00Z' };
  const r = BestiaryMerge.mergeBestiaries(imp, [...overrides, ...homebrew, orphan]);
  assertEq(r.length, 10 + 1 + 3);                                  // imported + 1 orphan + 3 homebrew
  const overridden = r.filter(x => x._overriddenAt);
  assertEq(overridden.length, 4);
  const orphans = r.filter(x => x._orphanOverride);
  assertEq(orphans.length, 1);
});
```

- [ ] **Step 3: Run tests; verify the first orphan test fails (current code only handles matched-overrides)**

Open `tests/bestiary-merge.test.html`, click Run. Expected: first 9 pass; orphan and mixed-everything tests fail. The other Task-3 tests (partial, null, cross-source) likely pass already from Task 2's code, but verify.

- [ ] **Step 4: Update `mergeBestiaries` in `bestiary-merge.js` to handle orphans**

Find the existing `mergeBestiaries` function and replace it with this version (which adds an orphan-emission pass between imported-walk and homebrew-append):

```js
  function mergeBestiaries(imported, custom) {
    const importedArr = arrayOf(imported);
    const customArr   = arrayOf(custom);

    // Index override records by match key; collect homebrew separately.
    const overrideIdx = new Map();
    const homebrew = [];
    for (const m of customArr) {
      if (isOverrideRecord(m)) {
        overrideIdx.set(recordKey(m), m);
      } else {
        homebrew.push({ ...m, _source: m._source || m.source || 'custom', _custom: true });
      }
    }

    // Walk imported, overlaying overrides where the key matches.
    const out = [];
    const matchedKeys = new Set();
    for (const m of importedArr) {
      const key = recordKey(m);
      const ov  = overrideIdx.get(key);
      const merged = { ...m, _source: m._source || m.source || '' };
      if (ov) {
        matchedKeys.add(key);
        for (const field of OVERRIDE_FIELDS) {
          if (ov[field] !== undefined && ov[field] !== null) merged[field] = ov[field];
        }
        merged._overriddenAt = ov.overriddenAt;
      }
      out.push(merged);
    }

    // Orphan overrides: any override record that didn't match an imported base.
    // Keep them visible so the DM can spot/clean them in the picker.
    for (const [key, ov] of overrideIdx) {
      if (!matchedKeys.has(key)) {
        out.push({
          ...ov,
          _source: ov._source || ov.source || '',
          _custom: true,
          _orphanOverride: true,
        });
      }
    }

    // Homebrew last.
    out.push(...homebrew);
    return out;
  }
```

- [ ] **Step 5: Re-run tests; verify all 14 pass**

- [ ] **Step 6: Commit**

```bash
git add bestiary-merge.js tests/bestiary-merge.test.html
git commit -m "bestiary-merge: orphan overrides + null-protection + edge-case fixtures"
```

---

## Phase 2 — Integration

### Task 4: Wire `crucible-dm.html` to use the merge

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-bestiary-merge-crucible"
cp crucible-dm.html "backups/${TS}-bestiary-merge-crucible/"
```

- [ ] **Step 2: Add the `<script src="bestiary-merge.js">` tag**

Find the existing parser/engine script tags in `crucible-dm.html`. The current order is:

```html
<script src="crucible-parser.js"></script>
<script src="crucible-engine.js"></script>
```

Insert `bestiary-merge.js` before them:

```html
<script src="bestiary-merge.js"></script>
<script src="crucible-parser.js"></script>
<script src="crucible-engine.js"></script>
```

- [ ] **Step 3: Replace the concat loops in `loadBestiary`**

Find this block in `crucible-dm.html`'s `loadBestiary` function (currently around lines 803-816, inside the `else` branch after the 401 check):

```js
      const imported = r.ok  ? await r.json() : { monsters: [] };
      const custom   = rc.ok ? await rc.json() : [];
      // Both endpoints tolerate envelope-or-bare-array shapes.
      const arr  = Array.isArray(imported) ? imported
                  : (Array.isArray(imported && imported.monsters) ? imported.monsters : []);
      const cust = Array.isArray(custom)   ? custom
                  : (Array.isArray(custom   && custom.monsters)   ? custom.monsters   : []);
      // Tag every monster with `_source` so the picker disambiguates duplicates
      // by name between MM-2024 and FM-v1 sources.
      for (const m of arr)  out.push({ ...m, _source: m.source || m._source || '' });
      for (const m of cust) out.push({ ...m, _source: m.source || m._source || 'custom', _custom: true });
      _bestiaryLoadStatus = out.length ? 'ok' : 'empty';
```

Replace it with:

```js
      const imported = r.ok  ? await r.json() : { monsters: [] };
      const custom   = rc.ok ? await rc.json() : [];
      // BestiaryMerge handles envelope-or-bare-array tolerance and overlays
      // override records onto their imported base by name+source.
      const merged = BestiaryMerge.mergeBestiaries(imported, custom);
      out.push(...merged);
      _bestiaryLoadStatus = merged.length ? 'ok' : 'empty';
```

- [ ] **Step 4: Manual verify in a browser**

Open `crucible-dm.html` (via `python3 -m http.server 8000` from project root, then `http://localhost:8000/crucible-dm.html`). Sign in as DM. Click "Add from Bestiary" — picker opens with monsters from the bestiary KV. If you've already saved a Crucible role override on a monster, that monster should now appear exactly **once** in the picker.

- [ ] **Step 5: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: route bestiary loader through BestiaryMerge.mergeBestiaries"
```

---

### Task 5: Wire `initiative-dm.html` (War Table) to use the merge

**Files:**
- Modify: `initiative-dm.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-bestiary-merge-wartable"
cp initiative-dm.html "backups/${TS}-bestiary-merge-wartable/"
```

- [ ] **Step 2: Add the `<script src="bestiary-merge.js">` tag**

Open `initiative-dm.html`. Find the existing `<script src="auth.js">` line (near the top of the body or in the head). Insert a new line below it:

```html
<script src="auth.js"></script>
<script src="bestiary-merge.js"></script>
```

(If `auth.js` is in the head, `bestiary-merge.js` goes in the head right after. Either location works as long as it loads before the inline `<script>` that defines `loadBestiary`.)

- [ ] **Step 3: Replace the concat in `loadBestiary`**

Find this line in `initiative-dm.html`'s `loadBestiary` function (around line 1210):

```js
    _BP.monsters = arr.concat(cust.map(m => ({ ...m, _custom: true })));
```

Replace with:

```js
    _BP.monsters = BestiaryMerge.mergeBestiaries(imported, custom);
```

(The existing `const arr = …; const cust = …;` lines above can stay — they're harmless after this change because nothing else reads them. Or remove them for cleanliness. Either is fine.)

- [ ] **Step 4: Manual verify in a browser**

Open the War Table, sign in as DM, click the bestiary picker button. If you've saved a Crucible role override on a monster, that monster appears once with the override applied. The full statblock (HP, AC, abilities) comes from the imported base; the `parsedActions` come from the override.

- [ ] **Step 5: Commit**

```bash
git add initiative-dm.html
git commit -m "War Table: route bestiary loader through BestiaryMerge.mergeBestiaries"
```

---

### Task 6: Wire `bestiary-dm.html` (Menagerie) to use the merge

**Files:**
- Modify: `bestiary-dm.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-bestiary-merge-menagerie"
cp bestiary-dm.html "backups/${TS}-bestiary-merge-menagerie/"
```

- [ ] **Step 2: Add the `<script src="bestiary-merge.js">` tag**

Open `bestiary-dm.html`. Find the `<script src="auth.js">` line. Add a new line below it:

```html
<script src="auth.js"></script>
<script src="bestiary-merge.js"></script>
```

- [ ] **Step 3: Replace the `allMonsters()` function body**

Find this block in `bestiary-dm.html` (around lines 989-992):

```js
    // The view across Browse / Analysis / lookups: imported bestiary + custom.
    function allMonsters(){
      return asMonsters(bestiary).concat(customMonsters.map(m => ({ ...m, _custom: true })));
    }
```

Replace with:

```js
    // The view across Browse / Analysis / lookups: imported bestiary + custom,
    // with Crucible-written override records overlaid onto their imported base.
    function allMonsters(){
      return BestiaryMerge.mergeBestiaries(asMonsters(bestiary), customMonsters);
    }
```

- [ ] **Step 4: Manual verify in a browser**

Open the Menagerie, sign in as DM. Browse the bestiary. If you've saved a Crucible role override on a monster, that monster appears once in the list with the overridden `parsedActions` visible. The existing edit-this-monster flow still writes back to the correct origin (`bestiary` for imported, `bestiary_custom` for homebrew).

Also verify: the "+ N custom" count display (around line 1069: `if (customMonsters.length) parts.push(\`+ ${customMonsters.length} custom\`)`) is unchanged — it counts the raw `customMonsters` length (which includes both homebrew and override records). That's acceptable for this spec; cosmetic refinement to display "+ X homebrew, Y overrides" is a future task if the DM finds the conflation confusing.

- [ ] **Step 5: Commit**

```bash
git add bestiary-dm.html
git commit -m "Menagerie: route allMonsters() through BestiaryMerge.mergeBestiaries"
```

---

## Phase 3 — Wrap-up

### Task 7: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add a new Unreleased entry at the top of `CHANGELOG.md`**

Find the existing `## [Unreleased] — 2026-06-02` line. Below it, insert the new entry as the first item in the Unreleased section:

```markdown
### Bestiary: override records overlay imported monsters at load (no more duplicate Goblins)

- New `bestiary-merge.js` shared module exporting
  `BestiaryMerge.mergeBestiaries(imported, custom)`. Override records
  (written by Crucible's `saveOverride`, identifiable by an
  `overriddenAt` stamp) now overlay their imported base by
  name+source. Homebrew records (no `overriddenAt`) pass through as
  before. Orphan overrides (no matching imported base) appear with a
  `_orphanOverride` flag so the DM can clean them up.
- The Crucible's `loadBestiary`, the War Table's `loadBestiary`, and
  the Menagerie's `allMonsters()` now all route through the same
  helper. Saved fixes propagate across tools — the DM sees one
  Owlbear with their override applied, not two.
- Worker is untouched. KV schema unchanged. Backward-compatible with
  every existing override record (no migration needed).
- 14 new test assertions in `tests/bestiary-merge.test.html` covering
  empty inputs, imported-only / homebrew-only / override-match
  paths, orphan handling, partial overrides, null-protection,
  cross-source distinctness, and a mixed-everything record-count
  scenario.

**Manual UI checklist (post-deploy):**
- [ ] Crucible: save a role override on an imported monster (set
      Owlbear to Brute). Refresh. Picker shows **one** Owlbear with
      `(currently: override)` in the Review panel — not two.
- [ ] War Table: open the bestiary picker. The same Owlbear appears
      exactly once with the override applied.
- [ ] Menagerie: browse the bestiary. The same Owlbear appears once
      with overrides visible. Edit it via the editor; the
      write-back-to-`bestiary` path still works.
- [ ] Orphan check: manually add an override record to
      `bestiary_custom` for a name that doesn't exist in `bestiary`.
      It appears in the Crucible picker with an orphan indicator.
- [ ] Backward compatibility: existing pre-merge `bestiary_custom`
      records (saved before this change) work without manual
      intervention — they have `overriddenAt`, name, _source, so they
      merge correctly.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "Changelog: bestiary override merge + propagation across tools"
```

---

## Notes for the implementer

- **No build step.** Every file is loaded directly by the browser. The new helper is exposed as `window.BestiaryMerge`. Tests are opened in a browser and run via the page's "Run tests" button.
- **Tests are pure functions, no DOM dependency.** `bestiary-merge.js` is loaded via `<script src="../bestiary-merge.js">` from the test page. No mocks needed.
- **Backups before mutating existing files** — each integration task starts with a `cp` to `backups/<timestamp>-<desc>/`. Honor this — it's project convention from CLAUDE.md.
- **Backward compatibility is structural.** Override records pre-dating this change already have `overriddenAt`, `name`, and `_source`. The merge handles them transparently. No migration runs at startup.
- **The Crucible's `saveOverride` is unchanged.** Don't refactor it as part of this work. The override-record shape it writes is the contract the merge layer consumes.
- **YAGNI.** Don't add a "(currently: X overrides)" display in the Menagerie or any orphan-cleanup UI as part of this plan — those are follow-up improvements. The orphan flag is data the UI *can* display; what it actually displays is a separate concern.
