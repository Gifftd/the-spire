# Persistent Combat Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-save in-progress combats to a new KV draft store, and surface un-exported drafts via a lobby banner on the initiative-dm page, so a forgotten export can be recovered later.

**Architecture:** Backend adds a single new DM-only KV type `combat_drafts` (array of draft objects) to `cloudflare-worker.js`. Frontend changes are confined to `initiative-dm.html`: drafts are upserted on every existing `pushState` debounce, marked `pending-export` on `endCombat()`, and removed on successful `exportToChronicle()`. A lightweight banner inside the existing lobby region lists pending drafts with [Export] / [Discard] buttons.

**Tech Stack:** Vanilla JS in a single HTML file (no build, no framework). Cloudflare Worker over KV. Manual browser verification (no automated test framework — this repo has no tests).

**Spec:** [docs/superpowers/specs/2026-06-11-persistent-combat-drafts-design.md](../specs/2026-06-11-persistent-combat-drafts-design.md)

---

## Reference: existing context the engineer needs

Read these before starting:
- `CLAUDE.md` — project conventions (no build step, KV-backed worker, backups + CHANGELOG required).
- The spec linked above — full design.
- `initiative-dm.html` lines 785–875 (combat state, `combatLog`, `snapshotCombatant`, `startCombat`, `endCombat`).
- `initiative-dm.html` lines 2046–2083 (`pushState` — the debounced KV writer).
- `initiative-dm.html` lines 2088–2311 (export modal: `openExport`, `buildCombatObject`, `buildMarkdown`, `exportToChronicle`).
- `cloudflare-worker.js` lines 320–340 (existing GET branches — pattern to follow).
- `cloudflare-worker.js` lines 670–685 (`DM_WRITE_TYPES` — where new write type goes).

**Critical gotcha (from `CLAUDE.md`):** Worker changes are NOT auto-deployed. After editing `cloudflare-worker.js`, the user pastes it into the Cloudflare dashboard manually. Front-end calls to a not-yet-redeployed worker will 401; the front-end must degrade gracefully (catch and silently swallow draft-related failures so the rest of the page still works).

**Branch:** Create `feature/persistent-combat-drafts` off `main` before starting Task 1.

---

## File Structure

- **Modify:** `cloudflare-worker.js`
  - Add GET branch for `combat_drafts` (DM-only, returns array).
  - Add `'combat_drafts'` to `DM_WRITE_TYPES`.
- **Modify:** `initiative-dm.html`
  - New module-level state: `currentDraftId`, `exportingDraftId`, `allDrafts`, `savedCombatLog`.
  - New helpers: `nowIso`, `mintDraftId`, `currentDraftSnapshot`, `pushDraft`, `removeDraft`, `saveDrafts`, `loadDrafts`, `promoteStaleDrafts`, `renderDraftBanner`, `handleBannerExport`, `handleBannerDiscard`.
  - Wire into existing functions: `startCombat`, `pushState`, `endCombat`, `openExport`, `closeExport`, `exportToChronicle`, `init`.
  - New HTML element: `<div id="draft-banner">` inside `.combatant-col`, above `#lobby-banner`.
  - New CSS: `.draft-banner`, `.draft-banner-row`, `.draft-banner-meta`, `.draft-banner-actions`.
- **Modify:** `CHANGELOG.md`
  - Entry under Unreleased section.

---

## Task 1: Create feature branch and snapshot baseline

**Files:**
- Create: `backups/<timestamp>-persistent-combat-drafts/initiative-dm.html`
- Create: `backups/<timestamp>-persistent-combat-drafts/cloudflare-worker.js`

- [ ] **Step 1: Create branch**

```bash
git checkout -b feature/persistent-combat-drafts
```

- [ ] **Step 2: Snapshot the two files we'll touch**

```bash
TS=$(date +%Y%m%d-%H%M%S)
BACKUP="backups/${TS}-persistent-combat-drafts"
mkdir -p "$BACKUP"
cp initiative-dm.html "$BACKUP/"
cp cloudflare-worker.js "$BACKUP/"
ls "$BACKUP"
```

Expected: both files listed in the new backup directory. (The `backups/` folder is gitignored — these are local only.)

- [ ] **Step 3: Commit nothing yet** — the branch starts clean. Continue to Task 2.

---

## Task 2: Worker — add `combat_drafts` to DM write types

**Files:**
- Modify: `cloudflare-worker.js` (the `DM_WRITE_TYPES` array)

- [ ] **Step 1: Add the new write type**

Find the line declaring `DM_WRITE_TYPES` (around line 674):

```js
const DM_WRITE_TYPES = ['initiative_state','map_data','map_data_dm','characters','journals','npcs','timeline','potion_ingredients','potions','negative_potions','potion_inventories','potion_recipes','potion_library','bestiary','bestiary_custom','encounters','feature_library'];
```

Add `'combat_drafts'` to the end of the array:

```js
const DM_WRITE_TYPES = ['initiative_state','map_data','map_data_dm','characters','journals','npcs','timeline','potion_ingredients','potions','negative_potions','potion_inventories','potion_recipes','potion_library','bestiary','bestiary_custom','encounters','feature_library','combat_drafts'];
```

- [ ] **Step 2: Commit**

```bash
git add cloudflare-worker.js
git commit -m "Worker: allow combat_drafts as a DM-gated POST type"
```

---

## Task 3: Worker — add DM-only GET branch for `combat_drafts`

**Files:**
- Modify: `cloudflare-worker.js` (insert a new GET branch)

- [ ] **Step 1: Add the GET branch**

Find the existing DM-only GET branch for `timeline_dm` (around line 395) — it looks like:

```js
      // DM-only: full timeline (includes planned entries + dmNotes).
      if (type === 'timeline_dm') {
        const auth = await verifyDMAuth(request, env);
        if (!auth.ok) return json({ error: 'DM auth required' }, 401);
        return json(await kvGet(env, 'timeline', []));
      }
```

Immediately below it, add a new branch:

```js
      // DM-only: combat drafts (auto-saved in-progress and pending-export combats).
      // Always DM-only — never returned to players. Drafts contain dmDetail HP logs.
      if (type === 'combat_drafts') {
        const auth = await verifyDMAuth(request, env);
        if (!auth.ok) return json({ error: 'DM auth required' }, 401);
        return json(await kvGet(env, 'combat_drafts', []));
      }
```

- [ ] **Step 2: Sanity-check the file**

```bash
node --check cloudflare-worker.js
```

Expected: no output (success). If you get a syntax error, fix it before committing.

- [ ] **Step 3: Commit**

```bash
git add cloudflare-worker.js
git commit -m "Worker: add DM-only GET branch for combat_drafts"
```

---

## Task 4: Frontend — add module-level state and helper utilities

**Files:**
- Modify: `initiative-dm.html` (inside the `<script>` block, near the existing state declarations around line 785)

This task adds the variables and pure helper functions only. It does NOT wire them in yet — that happens in Tasks 5–9. Splitting it makes the diff easy to review.

- [ ] **Step 1: Add module-level variables**

Find this block (around line 785):

```js
let mode = 'lobby'; // 'lobby' | 'combat'

let state = {
  round: 1,
  activeIndex: 0,
  combatants: [],
  customConditions: []
};

let combatLog   = {};  // { id: { name, type, startHp, maxHp, endHp, conditionsApplied, notes } }
```

Immediately after the `combatLog` line, add:

```js
// ── Persistent combat drafts ──
// `allDrafts` mirrors the KV array. `currentDraftId` is set during an active
// combat. `exportingDraftId` is set while the export modal is open and bound
// to a specific draft (the live one, or a recovered one from the banner).
// `savedCombatLog` stashes the live combatLog while exporting a recovered
// draft, so we can restore it when the modal closes.
let allDrafts = [];
let currentDraftId = null;
let exportingDraftId = null;
let savedCombatLog = null;
```

- [ ] **Step 2: Add helper functions**

Find the `// COMBAT LOG` section header (around line 825). Immediately *above* that header, add a new section:

```js
// ═══════════════════════════════════════════════════════
//  DRAFT PERSISTENCE
// ═══════════════════════════════════════════════════════
function nowIso() { return new Date().toISOString(); }

function mintDraftId() {
  return 'dr_' + Date.now() + '_' + Math.floor(Math.random() * 100000).toString(36);
}

// Serialize the in-memory combatLog (which holds Sets) into a KV-safe shape.
function serializeCombatLog(log) {
  const out = {};
  Object.keys(log).forEach(id => {
    const e = log[id];
    out[id] = {
      name: e.name, type: e.type,
      startHp: e.startHp, maxHp: e.maxHp, endHp: e.endHp,
      conditionsApplied: Array.from(e.conditionsApplied || []),
      notes: e.notes || ''
    };
  });
  return out;
}

// Rehydrate a KV-loaded combatLog: arrays back into Sets so the rest of
// the existing modal/export code works unchanged.
function deserializeCombatLog(log) {
  const out = {};
  Object.keys(log || {}).forEach(id => {
    const e = log[id] || {};
    out[id] = {
      name: e.name || '', type: e.type || 'enemy',
      startHp: e.startHp ?? 0, maxHp: e.maxHp ?? 0, endHp: e.endHp ?? 0,
      conditionsApplied: new Set(Array.isArray(e.conditionsApplied) ? e.conditionsApplied : []),
      notes: e.notes || ''
    };
  });
  return out;
}

function pcEnemyCounts() {
  let pc = 0, enemy = 0;
  Object.values(combatLog).forEach(e => {
    if (e.type === 'pc') pc++; else if (e.type === 'enemy') enemy++;
  });
  return { pc, enemy };
}

// Build the draft snapshot for the *currently active* combat.
// If `prev` is already pending-export (e.g., user opened the export modal
// from carryover, then cancelled — currentDraftId is still set, but the
// draft has been flipped), preserve that status so subsequent pushState
// writes don't accidentally re-open the combat.
function currentDraftSnapshot(prev) {
  const counts = pcEnemyCounts();
  const isPending = prev?.status === 'pending-export';
  return {
    id: currentDraftId,
    status: isPending ? 'pending-export' : 'in-progress',
    startedAt: prev?.startedAt || nowIso(),
    endedAt: isPending ? (prev?.endedAt || nowIso()) : null,
    savedAt: nowIso(),
    round: state.round,
    combatLog: serializeCombatLog(combatLog),
    title: prev?.title || '',
    pcCount: counts.pc,
    enemyCount: counts.enemy
  };
}

// Upsert a draft into allDrafts by id, then POST. Network errors are
// swallowed (degrade gracefully if the worker isn't redeployed yet).
async function saveDrafts() {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: Auth.dmHeaders(),
      body: JSON.stringify({ type: 'combat_drafts', payload: allDrafts })
    });
    if (res.status === 401) {
      // DM session expired or worker not yet redeployed. Don't logout —
      // initiative_state writes will handle that. Just stop saving drafts.
      return false;
    }
    return res.ok;
  } catch {
    return false;
  }
}

async function loadDrafts() {
  try {
    const res = await fetch(WORKER_URL + '?type=combat_drafts', {
      headers: Auth.dmHeaders()
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Any in-progress draft with savedAt older than 24h is promoted to
// pending-export so it surfaces in the banner instead of sitting invisible.
function promoteStaleDrafts(drafts) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let changed = false;
  drafts.forEach(d => {
    if (d.status === 'in-progress') {
      const t = Date.parse(d.savedAt || '');
      if (!isNaN(t) && t < cutoff) {
        d.status = 'pending-export';
        d.endedAt = d.savedAt;
        changed = true;
      }
    }
  });
  return changed;
}

function upsertDraft(draft) {
  const idx = allDrafts.findIndex(d => d.id === draft.id);
  if (idx >= 0) allDrafts[idx] = draft; else allDrafts.push(draft);
}

function removeDraft(id) {
  const idx = allDrafts.findIndex(d => d.id === id);
  if (idx >= 0) allDrafts.splice(idx, 1);
}
```

- [ ] **Step 3: Sanity-check the page still loads**

Start a local server in one terminal:

```bash
python3 -m http.server 8000
```

In your browser, open `http://localhost:8000/initiative-dm.html` and DM-log-in. Open devtools. Confirm:
- No JS errors in the console.
- The page renders normally (lobby banner visible, add-combatant form present).

You should be able to add a PC and click Start Combat / End Combat exactly as before — no behavior change yet.

- [ ] **Step 4: Commit**

```bash
git add initiative-dm.html
git commit -m "Initiative DM: add draft persistence helpers (no wiring yet)"
```

---

## Task 5: Frontend — wire `startCombat()` and `pushState()` to save the in-progress draft

**Files:**
- Modify: `initiative-dm.html` (the existing `startCombat` and `pushState` functions)

- [ ] **Step 1: Update `startCombat()`**

Find:

```js
function startCombat() {
  mode = 'combat';
  initCombatLog();
  updateModeUI();
  pushState();
}
```

Replace with:

```js
function startCombat() {
  mode = 'combat';
  initCombatLog();
  currentDraftId = mintDraftId();
  updateModeUI();
  pushState();
}
```

- [ ] **Step 2: Update `pushState()` to also save the active draft**

Find the existing `pushState` (around line 2046). Inside the debounced callback, after the existing `fetch` for `initiative_state` resolves, add a parallel POST for the current draft. The cleanest shape is:

```js
async function pushState() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    setSyncStatus('ing','⟳ Syncing…');
    const visibleCombatants = state.combatants.filter(c => !c.hidden);
    const activeCombatant   = state.combatants[state.activeIndex];
    const visibleActiveIndex = activeCombatant
      ? visibleCombatants.findIndex(c => c.id === activeCombatant.id)
      : 0;

    const playerState = {
      mode,
      round: state.round,
      activeIndex: Math.max(0, visibleActiveIndex),
      combatants: visibleCombatants.map(c => ({
        id: c.id, name: c.name, type: c.type,
        init: c.init,
        ac: c.type === 'pc' ? c.ac : null,
        hpPct: Math.round((c.hp/c.maxHp)*100),
        hp:    c.type==='pc' ? c.hp    : null,
        maxHp: c.type==='pc' ? c.maxHp : null,
        conditions: c.conditions, dead: c.dead
      }))
    };

    // Build the draft snapshot if there's an active combat. Drafts are
    // saved in parallel with the player state; a failure here does not
    // affect the main sync indicator.
    let draftPromise = Promise.resolve(true);
    if (currentDraftId) {
      const prev = allDrafts.find(d => d.id === currentDraftId);
      const draft = currentDraftSnapshot(prev);
      upsertDraft(draft);
      draftPromise = saveDrafts();
    }

    try {
      const res = await fetch(WORKER_URL, {
        method:'POST', headers: Auth.dmHeaders(),
        body: JSON.stringify({ type:'initiative_state', payload: playerState })
      });
      if (res.status === 401) {
        Auth.logout();
        window.location.replace('home.html?notice=' + encodeURIComponent('Your DM session expired — sign in again.'));
        return;
      }
      await draftPromise;
      setSyncStatus(res.ok?'ok':'fail', res.ok?'✦ Synced':'⚠ Sync failed');
    } catch { setSyncStatus('fail','⚠ Offline'); }
  }, 600);
}
```

The only changes vs the original are:
1. The `let draftPromise = …; if (currentDraftId) { … }` block before the existing `try`.
2. The `await draftPromise;` line right before `setSyncStatus(...)`.

- [ ] **Step 3: Browser verification**

Hard-refresh `http://localhost:8000/initiative-dm.html`. With devtools Network tab open:
- Add a PC. Click **Start Combat**.
- Watch the Network tab — within ~1s you should see TWO POSTs to the worker URL: one with `type:"initiative_state"`, one with `type:"combat_drafts"`.
- Apply damage to the PC. Confirm both POSTs fire again on the next debounce.
- In a devtools console tab, fetch the draft list:

```js
fetch('https://dnd-perk-webhook.jacobgiff.workers.dev/?type=combat_drafts', {headers: Auth.dmHeaders()}).then(r=>r.json()).then(console.log)
```

Expected: an array with one object whose `status === 'in-progress'`, the right `round`, and a `combatLog` that contains your PC's id.

If the worker hasn't been redeployed yet, this fetch returns `401` and `allDrafts` stays empty — that's the graceful-degrade path. Verify by checking that no console errors appear.

- [ ] **Step 4: Commit**

```bash
git add initiative-dm.html
git commit -m "Initiative DM: save in-progress combat draft on every pushState"
```

---

## Task 6: Frontend — flip draft to `pending-export` on `endCombat()`

**Files:**
- Modify: `initiative-dm.html` (the existing `endCombat` function)

- [ ] **Step 1: Update `endCombat()`**

Find:

```js
function endCombat() {
  // Snapshot everything before opening modal
  state.combatants.forEach(snapshotCombatant);
  openCarryover();
}
```

Replace with:

```js
async function endCombat() {
  // Snapshot everything before opening modal
  state.combatants.forEach(snapshotCombatant);
  if (currentDraftId) {
    const prev = allDrafts.find(d => d.id === currentDraftId);
    const draft = currentDraftSnapshot(prev);
    draft.status = 'pending-export';
    draft.endedAt = nowIso();
    upsertDraft(draft);
    // Immediate (non-debounced) save: this is the user-visible safety
    // milestone. If it fails, the carry-over modal still opens — the
    // next pushState will retry. We KEEP currentDraftId set so that if
    // the user picks "Export & Carry Over", openExport() binds the modal
    // to this draft via exportingDraftId = currentDraftId. The id is
    // cleared on the next startCombat() (which overwrites it) or on
    // successful exportToChronicle().
    await saveDrafts();
  }
  openCarryover();
}
```

- [ ] **Step 2: Browser verification**

Refresh the page. Start a combat with one PC and one enemy. Apply damage. Click **End Combat**. The carry-over modal opens (existing behavior). Close it without exporting.

In devtools console:

```js
fetch('https://dnd-perk-webhook.jacobgiff.workers.dev/?type=combat_drafts', {headers: Auth.dmHeaders()}).then(r=>r.json()).then(console.log)
```

Expected: an array with one object whose `status === 'pending-export'`, a non-null `endedAt`, and your combat data intact.

- [ ] **Step 3: Commit**

```bash
git add initiative-dm.html
git commit -m "Initiative DM: flip draft to pending-export on endCombat"
```

---

## Task 7: Frontend — clear draft on successful `exportToChronicle()`

**Files:**
- Modify: `initiative-dm.html` (`openExport`, `closeExport`, `exportToChronicle`)

- [ ] **Step 1: Update `openExport()` to track the bound draft id**

Find:

```js
function openExport() {
  state.combatants.forEach(snapshotCombatant);
  const today = new Date();
  document.getElementById('exp-date').value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  // Reset the chronicle section each time the modal opens.
  document.getElementById('exp-to-chronicle').checked = false;
  document.getElementById('exp-chronicle-body').style.display = 'none';
  document.getElementById('exp-chronicle-btn').style.display  = 'none';
  document.getElementById('loot-rows').innerHTML = '';
  document.getElementById('exp-new-session-title').value = '';
  document.getElementById('exp-new-session-date').value = '';
  updatePreview();
  document.getElementById('export-modal').classList.remove('hidden');
}
```

Replace with:

```js
// opts.fromDraft (default false) — when true, the caller has already
// swapped combatLog to a recovered draft's data and bound exportingDraftId
// itself. In that case we MUST NOT snapshot the lobby's live combatants
// into combatLog (it would pollute the recovered draft's data) and we
// MUST NOT override exportingDraftId.
function openExport(opts) {
  opts = opts || {};
  if (!opts.fromDraft) {
    state.combatants.forEach(snapshotCombatant);
    // Bind the modal to whichever draft is active (the live combat's).
    // After endCombat the id is still set (intentional), so this still works
    // when invoked via openExportFromCarryover().
    exportingDraftId = currentDraftId;
  }
  const today = new Date();
  document.getElementById('exp-date').value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  // Reset the chronicle section each time the modal opens.
  document.getElementById('exp-to-chronicle').checked = false;
  document.getElementById('exp-chronicle-body').style.display = 'none';
  document.getElementById('exp-chronicle-btn').style.display  = 'none';
  document.getElementById('loot-rows').innerHTML = '';
  document.getElementById('exp-new-session-title').value = '';
  document.getElementById('exp-new-session-date').value = '';
  updatePreview();
  document.getElementById('export-modal').classList.remove('hidden');
}
```

- [ ] **Step 2: Update `closeExport()` to clear the binding and restore stashed combatLog**

Find:

```js
function closeExport() {
  document.getElementById('export-modal').classList.add('hidden');
  if (exportCalledFromCarryover) { exportCalledFromCarryover = false; openCarryover(); }
}
```

Replace with:

```js
function closeExport() {
  document.getElementById('export-modal').classList.add('hidden');
  // If we swapped combatLog for a recovered draft, restore the live one.
  if (savedCombatLog !== null) {
    combatLog = savedCombatLog;
    savedCombatLog = null;
  }
  exportingDraftId = null;
  if (exportCalledFromCarryover) { exportCalledFromCarryover = false; openCarryover(); }
}
```

- [ ] **Step 3: Update `exportToChronicle()` to remove the draft on success**

Find:

```js
  const btn = document.getElementById('exp-chronicle-btn');
  btn.disabled = true; btn.textContent = '…';
  try {
    const r = await fetch(WORKER_URL, { method:'POST', headers: Auth.dmHeaders(), body: JSON.stringify({ type:'timeline', payload: chronicleAll }) });
    if (r.status === 401) {
      Auth.logout();
      window.location.replace('home.html?notice=' + encodeURIComponent('Your DM session expired — sign in again.'));
      return;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    setSyncStatus('ok', '✦ Added to Chronicle');
    setTimeout(() => setSyncStatus('', ''), 3000);
    closeExport();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Add to Chronicle';
    alert('Could not reach the Chronicle. Try again.');
  }
```

Replace with:

```js
  const btn = document.getElementById('exp-chronicle-btn');
  btn.disabled = true; btn.textContent = '…';
  try {
    const r = await fetch(WORKER_URL, { method:'POST', headers: Auth.dmHeaders(), body: JSON.stringify({ type:'timeline', payload: chronicleAll }) });
    if (r.status === 401) {
      Auth.logout();
      window.location.replace('home.html?notice=' + encodeURIComponent('Your DM session expired — sign in again.'));
      return;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    // Chronicle write succeeded — drop the bound draft (best-effort).
    if (exportingDraftId) {
      removeDraft(exportingDraftId);
      // If we just exported the live combat, clear currentDraftId so the
      // next pushState doesn't re-create the draft we just removed.
      if (exportingDraftId === currentDraftId) currentDraftId = null;
      await saveDrafts();
      // Refresh the banner in case the user exported a recovered draft.
      renderDraftBanner();
    }
    setSyncStatus('ok', '✦ Added to Chronicle');
    setTimeout(() => setSyncStatus('', ''), 3000);
    closeExport();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Add to Chronicle';
    alert('Could not reach the Chronicle. Try again.');
  }
```

Note: `renderDraftBanner` is defined in Task 8. Since JS function declarations are hoisted, calling it from here before Task 8 is wired in would throw `ReferenceError`. We resolve this by adding a temporary no-op stub now and replacing it in Task 8.

- [ ] **Step 4: Add a temporary `renderDraftBanner` stub**

Inside the `DRAFT PERSISTENCE` section you added in Task 4, after the `removeDraft` function, add:

```js
// Placeholder — wired up in the banner task. Kept as a no-op so callers
// (e.g. exportToChronicle) work before the banner module lands.
function renderDraftBanner() { /* replaced in Task 8 */ }
```

- [ ] **Step 5: Browser verification**

Refresh page. With existing pending-export draft from Task 6 still in KV:
- Open the export modal (you'll need to be in an active combat to see the button — start a fresh combat for this test).
- Fill out the title and pick "Add to chronicle".
- Pick "New session" or an existing one, then click **Add to Chronicle**.
- Expected: sync indicator shows "✦ Added to Chronicle", modal closes.

In devtools console:

```js
fetch('https://dnd-perk-webhook.jacobgiff.workers.dev/?type=combat_drafts', {headers: Auth.dmHeaders()}).then(r=>r.json()).then(console.log)
```

Expected: the draft for the combat you just exported is gone. (The earlier pending-export draft from Task 6 may still be there — that's fine; we'll deal with it via the banner in the next task.)

- [ ] **Step 6: Commit**

```bash
git add initiative-dm.html
git commit -m "Initiative DM: drop draft from KV after successful chronicle export"
```

---

## Task 8: Frontend — recovery banner UI

**Files:**
- Modify: `initiative-dm.html` (HTML markup, CSS, JS handlers)

- [ ] **Step 1: Add CSS for the banner**

Find the existing `.lobby-banner` CSS block (around line 145):

```css
/* ── Lobby banner ── */
.lobby-banner {
  background: var(--lobby-bg);
  border: 1px solid var(--lobby-accent);
  border-radius: var(--radius);
  padding: 10px 14px;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: 'Cinzel', serif;
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  color: #80c0c0;
}
.lobby-banner.hidden { display: none; }
.lobby-banner-icon { font-size: 1.1rem; }
```

Immediately after it, add:

```css
/* ── Draft recovery banner ── */
.draft-banner {
  background: rgba(192, 130, 50, 0.08);
  border: 1px solid #c08232;
  border-radius: var(--radius);
  padding: 10px 14px;
  margin-bottom: 1rem;
  font-family: 'Cinzel', serif;
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  color: #d4a060;
}
.draft-banner.hidden { display: none; }
.draft-banner-title {
  font-size: 0.78rem;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.draft-banner-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-top: 1px solid rgba(192, 130, 50, 0.2);
  font-family: 'Crimson Text', serif;
  font-size: 0.85rem;
  letter-spacing: 0;
}
.draft-banner-meta { color: var(--ink); }
.draft-banner-meta .draft-date { color: var(--ink-faint); font-size: 0.78rem; }
.draft-banner-actions { display: flex; gap: 6px; }
```

- [ ] **Step 2: Add the banner element to the markup**

Find the `<div class="combatant-col">` block (around line 518). Immediately *before* the existing `<div class="lobby-banner" id="lobby-banner">`, add:

```html
    <div class="draft-banner hidden" id="draft-banner"></div>
```

The lobby region now looks like:

```html
  <div class="combatant-col">
    <div class="draft-banner hidden" id="draft-banner"></div>
    <div class="lobby-banner" id="lobby-banner">
      <span class="lobby-banner-icon">🔒</span>
      <span>You are in <strong>Lobby</strong> mode — players see "Combat incoming…" until you press Start Combat. Add enemies and set initiative freely.</span>
    </div>
    ...
```

- [ ] **Step 3: Update `updateModeUI()` to hide the banner during combat**

Find:

```js
  document.getElementById('lobby-banner').classList.toggle('hidden', inCombat);
  document.getElementById('lobby-pc-section').style.display = inCombat ? 'none' : '';
```

Add a line below the first. We hide the banner directly on combat-entry and call `renderDraftBanner()` on combat-exit so a freshly-saved pending-export draft surfaces immediately (without requiring a page refresh):

```js
  document.getElementById('lobby-banner').classList.toggle('hidden', inCombat);
  if (inCombat) {
    document.getElementById('draft-banner').classList.add('hidden');
  } else {
    // Returning to lobby — re-render so any pending-export drafts surface.
    renderDraftBanner();
  }
  document.getElementById('lobby-pc-section').style.display = inCombat ? 'none' : '';
```

- [ ] **Step 4: Replace the `renderDraftBanner` stub with the real implementation**

Find the stub from Task 7:

```js
// Placeholder — wired up in the banner task. Kept as a no-op so callers
// (e.g. exportToChronicle) work before the banner module lands.
function renderDraftBanner() { /* replaced in Task 8 */ }
```

Replace with:

```js
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDraftDate(iso) {
  if (!iso) return '';
  // Show local date only — YYYY-MM-DD is enough context for the DM.
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  } catch { return ''; }
}

function renderDraftBanner() {
  const el = document.getElementById('draft-banner');
  if (!el) return;
  if (mode === 'combat') { el.classList.add('hidden'); return; }
  const pending = allDrafts.filter(d => d.status === 'pending-export');
  if (pending.length === 0) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  // Newest first.
  pending.sort((a, b) => (b.endedAt || b.savedAt || '').localeCompare(a.endedAt || a.savedAt || ''));
  const rows = pending.map(d => {
    const date  = formatDraftDate(d.endedAt || d.savedAt);
    const title = escapeHtml(d.title || 'Combat');
    const rounds = d.round || 0;
    const pcs    = d.pcCount || 0;
    const enem   = d.enemyCount || 0;
    return `
      <div class="draft-banner-row" data-draft-id="${escapeHtml(d.id)}">
        <div class="draft-banner-meta">
          <div>${title} <span class="draft-date">— ${date}</span></div>
          <div class="draft-date">${rounds} round${rounds === 1 ? '' : 's'}, ${pcs} PC${pcs === 1 ? '' : 's'} / ${enem} enem${enem === 1 ? 'y' : 'ies'}</div>
        </div>
        <div class="draft-banner-actions">
          <button class="btn btn-gold btn-sm" onclick="handleBannerExport('${escapeHtml(d.id)}')">Export</button>
          <button class="btn btn-ghost btn-sm" onclick="handleBannerDiscard('${escapeHtml(d.id)}')">Discard</button>
        </div>
      </div>
    `;
  }).join('');
  const titleLine = pending.length === 1
    ? '⚠ You have 1 un-exported combat from a previous session.'
    : `⚠ You have ${pending.length} un-exported combats from previous sessions.`;
  el.innerHTML = `<div class="draft-banner-title">${titleLine}</div>${rows}`;
  el.classList.remove('hidden');
}

function handleBannerExport(draftId) {
  const d = allDrafts.find(x => x.id === draftId);
  if (!d) { renderDraftBanner(); return; }
  // Stash the live combatLog so closeExport() can restore it.
  savedCombatLog = combatLog;
  combatLog = deserializeCombatLog(d.combatLog);
  // Bind the modal to the recovered draft BEFORE opening, and tell
  // openExport() to skip its live-combatant snapshot (which would
  // pollute the recovered combatLog).
  exportingDraftId = draftId;
  openExport({ fromDraft: true });
  if (d.title) {
    const titleEl = document.getElementById('exp-title');
    if (titleEl) { titleEl.value = d.title; updatePreview(); }
  }
}

async function handleBannerDiscard(draftId) {
  if (!confirm('Discard this combat log? This cannot be undone.')) return;
  removeDraft(draftId);
  await saveDrafts();
  renderDraftBanner();
}
```

- [ ] **Step 5: Browser verification (rendering only — init wiring is Task 9)**

Refresh the page. The banner is still hidden because nothing has loaded `allDrafts` from KV yet on init. To verify the rendering works in isolation, paste into devtools console:

```js
loadDrafts().then(d => { allDrafts = d; renderDraftBanner(); });
```

Expected: if you have pending-export drafts in KV (e.g. from Task 6), the banner appears above the lobby banner with one row per draft. Each row shows title, date, round count, PC/enemy counts, and the two buttons.

Click **Discard** on one row. Expected: confirm prompt, then the row disappears. Verify in devtools the KV array shrank.

- [ ] **Step 6: Commit**

```bash
git add initiative-dm.html
git commit -m "Initiative DM: recovery banner for un-exported combat drafts"
```

---

## Task 9: Frontend — load drafts and render banner on `init()`

**Files:**
- Modify: `initiative-dm.html` (the existing `init` function)

- [ ] **Step 1: Update `init()`**

Find:

```js
function init() {
  state.customConditions = loadCustomConds();
  const pcs = loadPCs();
  if (pcs.length > 0) { state.combatants = pcs; _id = Math.max(...pcs.map(c=>c.id), 0); }
  updateModeUI();
  render();
  pushState();
  // PC is default type — hide the hidden checkbox
  document.getElementById('add-hidden').closest('label').style.display = 'none';
  ['add-name','add-init','add-hp','add-ac'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if(e.key==='Enter') addCombatant(); });
  });
}
init();
```

Replace with:

```js
async function init() {
  state.customConditions = loadCustomConds();
  const pcs = loadPCs();
  if (pcs.length > 0) { state.combatants = pcs; _id = Math.max(...pcs.map(c=>c.id), 0); }
  updateModeUI();
  render();
  pushState();
  // PC is default type — hide the hidden checkbox
  document.getElementById('add-hidden').closest('label').style.display = 'none';
  ['add-name','add-init','add-hp','add-ac'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if(e.key==='Enter') addCombatant(); });
  });

  // Load drafts from KV, auto-promote stale in-progress drafts, render banner.
  // Requires DM auth; if it fails (e.g., worker not redeployed), degrade silently.
  allDrafts = await loadDrafts();
  if (promoteStaleDrafts(allDrafts)) {
    await saveDrafts();
  }
  renderDraftBanner();
}
init();
```

- [ ] **Step 2: Full end-to-end browser verification**

This is the integration check. Hard-refresh `http://localhost:8000/initiative-dm.html`.

Test cases — work through them in order:

1. **Banner shows on page load.** If pending-export drafts exist in KV from previous tasks, the banner should appear above the lobby banner. If you've emptied KV, do this first to seed:
   - Start a combat with one PC and one enemy. Apply some damage. End Combat. Close the carry-over without exporting. Hard-refresh. Banner should appear with one row.

2. **Export from banner.** Click [Export] on the banner row. Export modal opens. Check "Add this combat to the campaign timeline", pick a session option, click Add to Chronicle. Expected:
   - Sync indicator shows "✦ Added to Chronicle".
   - Modal closes.
   - Banner row disappears.
   - Timeline entry exists (verify by opening `timeline.html` or `sessions-dm.html`).

3. **Discard from banner.** Seed another pending-export draft (run a quick combat, end it, refresh). Click [Discard]. Confirm. Expected: row disappears, KV array shrinks.

4. **Multiple drafts.** Run two short combats back-to-back, each ending without export. Refresh. Banner should show two rows. Export one and discard the other; banner empties and disappears.

5. **Player view isolation.** With drafts in KV, open `initiative-player.html` in another tab (no login). Expected: page works normally, no console errors. Open devtools Network and confirm no request for `combat_drafts` is made. Open `map.html` as anonymous. Same expectation.

6. **Mid-combat crash recovery (manual).** Start a combat, apply damage. In devtools, fetch `combat_drafts` — the draft has `status: 'in-progress'`. Close the tab without ending combat. Reopen `initiative-dm.html`. The banner does NOT show (status is still in-progress, < 24h old) — this is expected. To verify the 24h promote rule: in devtools, fetch the array, manually adjust one draft's `savedAt` to be 25+ hours ago, POST it back. Refresh the page. Banner now shows that draft.

   Reference snippet for that manipulation:

   ```js
   const url = 'https://dnd-perk-webhook.jacobgiff.workers.dev/';
   const arr = await (await fetch(url + '?type=combat_drafts', {headers: Auth.dmHeaders()})).json();
   arr[0].savedAt = new Date(Date.now() - 25*60*60*1000).toISOString();
   await fetch(url, {method:'POST', headers: Auth.dmHeaders(), body: JSON.stringify({type:'combat_drafts', payload: arr})});
   location.reload();
   ```

7. **Worker not redeployed (negative path).** This is hard to test without rolling back the worker. Skip unless you can do it safely. Behavior should be: drafts never appear, no console errors, the rest of the page works.

If any test fails, fix the issue, re-verify the failing test, and continue. Do not move on with broken behavior.

- [ ] **Step 3: Commit**

```bash
git add initiative-dm.html
git commit -m "Initiative DM: load drafts on init and render recovery banner"
```

---

## Task 10: Changelog and PR

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add an entry under the Unreleased section**

Open `CHANGELOG.md` and add the following at the top of the Unreleased section (or create one if missing — match the existing date/heading style by reading the most recent entry):

```markdown
### Persistent combat drafts (recovery for forgotten exports)
- **Worker:** new DM-only KV type `combat_drafts` — GET branch + added to `DM_WRITE_TYPES`. **Worker must be redeployed** for drafts to persist.
- **Initiative DM:** combat log is now auto-saved to KV on every existing `pushState` debounce. `endCombat()` flips the draft to `pending-export`. `exportToChronicle()` removes the draft after a successful Chronicle write.
- **Recovery banner** above the lobby banner shows any un-exported drafts on page load, with per-row Export and Discard buttons. Active combat hides the banner; it reappears on next page load if a draft is still pending.
- In-progress drafts older than 24h auto-promote to `pending-export` to surface crashed-mid-combat orphans.
- Player views (`initiative-player.html`, `map.html`) are unaffected — drafts are DM-only end to end.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "Changelog: persistent combat drafts"
```

- [ ] **Step 3: Push branch and open PR**

```bash
git push -u origin feature/persistent-combat-drafts
```

Open the compare URL in your browser (the `gh` CLI is not installed per CLAUDE.md):

```
https://github.com/Gifftd/the-spire/compare/main...feature/persistent-combat-drafts
```

Use this PR body:

```markdown
## Summary
- Combat data now auto-saves to a new DM-only `combat_drafts` KV key on every `pushState`.
- `endCombat()` flips the draft to `pending-export`; `exportToChronicle()` removes it on success.
- A new recovery banner on the initiative-dm lobby surfaces any un-exported drafts on page load, with per-row Export and Discard buttons.
- 24h auto-promote rule surfaces crashed-mid-combat orphans.

## Deployment notes
- **Worker must be redeployed** (paste `cloudflare-worker.js` into the Cloudflare dashboard) for drafts to persist. Until then, the front-end degrades gracefully — no drafts saved, no errors.
- Hard-refresh `initiative-dm.html` after merge (GitHub Pages cache).

## Test plan
- [ ] End combat without exporting → reload → banner appears
- [ ] Click Export on banner row → modal pre-fills → Add to Chronicle → row disappears, timeline entry exists
- [ ] Click Discard on banner row → confirm → row disappears
- [ ] Multiple un-exported combats stacked → banner shows all
- [ ] Player views (`initiative-player.html`, `map.html` anonymous) — no leak, no errors
- [ ] 24h auto-promote rule (manually adjust savedAt in KV)
```

---

## Self-review checklist (run before handoff)

These are sanity checks the engineer should run as a final pass. Do not skip.

- [ ] **All worker edits are bundled in one file** — `cloudflare-worker.js`. The user pastes this file into the Cloudflare dashboard once after merge. No other deploy steps.
- [ ] **`renderDraftBanner` is defined before `exportToChronicle` calls it** — JS function declarations hoist, so order in the file doesn't matter, but the function must exist (stub in Task 7, real impl in Task 8). After Task 8 is done, `grep -n "function renderDraftBanner" initiative-dm.html` should return exactly one line.
- [ ] **No leftover stub** — after Task 8 the placeholder comment `/* replaced in Task 8 */` should be gone.
- [ ] **Draft serialization round-trip works** — `serializeCombatLog → JSON → deserializeCombatLog` yields a structure that the existing `buildCombatObject`, `buildMarkdown`, and `pcEnemyCounts` helpers all read correctly. In particular: `conditionsApplied` must be a `Set` after deserialization (these helpers iterate it).
- [ ] **`initiative_state` payload is unchanged** — the `playerState` object in `pushState` has the same shape as before. Players see no new fields, no different data. Worker's `initiative_state` GET handler is untouched.
- [ ] **Backups exist** — Task 1 created `backups/<timestamp>-persistent-combat-drafts/` with the two original files. (Not committed; `backups/` is gitignored.)
- [ ] **CHANGELOG updated** — Task 10 added an entry.
