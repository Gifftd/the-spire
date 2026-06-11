# Persistent Combat Drafts

**Status:** Draft
**Date:** 2026-06-11
**Files affected:** `initiative-dm.html`, `cloudflare-worker.js`

## Problem

Combat data in `initiative-dm.html` lives only in the in-memory `combatLog`
JavaScript variable. It is wiped when:

- The DM starts a new combat (`startCombat()` resets `combatLog = {}`)
- The page is refreshed or closed
- The browser/tab crashes mid-combat

The only path that persists combat data anywhere is the "Add to Chronicle"
button in the export modal, which writes combats into a timeline entry's
`combats[]` array. If the DM forgets to export — or skips the export modal
from the carry-over prompt — the entire combat log is permanently lost the
moment a new combat begins or the page reloads.

A real-world incident motivated this: the DM ran a session, ended combat
without exporting, then could not populate session notes after the fact.

## Goals

- The DM never loses combat data because they forgot to export.
- Combat data survives mid-combat browser crashes and tab closes.
- Recovery is surfaced exactly where the DM will look: the initiative page.
- No new pages or browsable archive UI — the chronicle remains the canonical
  "vault" for finished combats.
- Player-facing state (`initiative_state`) is unchanged. Drafts are DM-only.

## Non-goals

- Browsable archive of all past combats. The Chronicle is the archive.
- Mid-combat resume on a different device. (Out of scope; the existing
  `initiative_state` already gives the player view that.)
- Auto-expire / janitor cleanup of pending drafts. Drafts persist until
  explicitly exported or discarded.
- Markdown rendering or other display changes in the chronicle. The export
  output is unchanged.

## Design

### Storage

A new KV key, **`combat_drafts`**, stores an array of draft objects. It is
separate from `initiative_state` because drafts contain DM-only HP-log detail
that must never reach the player view's filtering pipeline.

Draft shape:

```js
{
  id: 'dr_<timestamp>_<rand>',
  status: 'in-progress' | 'pending-export',
  startedAt: '2026-06-11T19:30:00Z',  // ISO 8601
  endedAt:   null | '2026-06-11T20:45:00Z',
  savedAt:   '2026-06-11T20:46:12Z',  // updated on every write
  round: 5,
  combatLog: { /* the existing combatLog dict, verbatim */ },
  // light banner metadata:
  title: '',          // pre-filled if the DM opened the export modal
  pcCount: 4,
  enemyCount: 6
}
```

`combatLog` retains its current shape:
`{ id: { name, type, startHp, maxHp, endHp, conditionsApplied (Set), notes } }`.
The `Set` is serialized to an array on write and rehydrated on read.

### Save flow (write path)

In `initiative-dm.html`:

1. Add a module-level `let currentDraftId = null`.
2. `startCombat()` mints a new id (`'dr_' + Date.now() + '_' + rand`) and
   assigns it to `currentDraftId`. The next debounced `pushState` writes the
   draft.
3. `pushState()` keeps its existing 600 ms debounce and `initiative_state`
   POST. When `currentDraftId` is set, it issues a *second parallel* POST of
   type `combat_drafts` containing the full updated array — read-modify-write
   on the local cache of drafts (kept in `let allDrafts = []`). Upsert the
   current draft by id; do not touch others. The two POSTs run with
   `Promise.all`; both must succeed for the sync indicator to show "Synced".
4. `endCombat()` flips the current draft to `status: 'pending-export'`,
   `endedAt: nowIso()`, persists immediately (not debounced — this is the
   user-visible safety milestone), then clears `currentDraftId`. The
   carry-over modal opens after this write resolves.
5. `exportToChronicle()`: a new module-level `exportingDraftId` holds the id
   of whichever draft the open modal is currently bound to (set by
   `openExport()` to `currentDraftId`, or by the banner's [Export] handler
   to that row's draft id). After the existing Chronicle POST succeeds,
   remove the draft with that id from `allDrafts` and POST the new array.
   If the Chronicle POST fails, the draft is left intact so the DM can
   retry. `exportingDraftId` is cleared on modal close regardless of
   outcome.

### Recovery flow (read path + banner)

In `initiative-dm.html` `init()`:

1. After existing setup, GET `combat_drafts` from the worker. Populate
   `allDrafts`.
2. Auto-promote: any draft with `status === 'in-progress'` whose `savedAt` is
   older than 24 hours is flipped to `pending-export` (set `endedAt` to its
   `savedAt`). If any promotions happened, persist the array back.
3. Filter to `pending-export` drafts. If empty, do nothing.
4. Otherwise render the banner inside the lobby region. The existing
   `#lobby-banner` element is already toggled `hidden` whenever
   `mode === 'combat'` (see `updateModeUI`), so placing the new banner as a
   sibling under the same parent — or inside the same element — gives it
   the correct show/hide behavior for free.

Banner markup (one row per pending draft):

```
⚠ You have 2 un-exported combats from previous sessions.
  • Combat — 2026-06-09, 5 rounds, 4 PCs / 6 enemies     [Export] [Discard]
  • Combat — 2026-06-10, 3 rounds, 4 PCs / 2 enemies     [Export] [Discard]
```

Date shown is `endedAt` (falling back to `savedAt`). Title falls back to
`'Combat'` if blank.

**[Export]** behavior:
- Save the draft's `combatLog` into a temporary holder, then swap it into the
  module-level `combatLog` variable.
- Call `openExport()` as usual. `buildCombatObject` / `buildMarkdown` /
  `exportToChronicle` already read from `combatLog`, so the rest is unchanged.
- Track the exporting draft's id in a new `exportingDraftId` var so
  `exportToChronicle` knows which draft to remove on success (instead of
  `currentDraftId`, which would be null in the "no live combat" case).
- On modal close without export, restore the prior `combatLog` value (the
  live combat's, if any).

**[Discard]** behavior:
- `confirm('Discard this combat log? This cannot be undone.')`.
- On confirm: remove the draft from `allDrafts`, persist, remove the banner
  row. Hide the whole banner if no rows remain.

The banner is never shown while `mode === 'combat'`. It hides itself on
`startCombat()` (the lobby banner is already hidden then) and reappears on
end-of-combat → reload if drafts remain.

### Worker changes (`cloudflare-worker.js`)

1. Add `'combat_drafts'` to the `DM_WRITE_TYPES` array (~line 674) so POSTs
   are DM-gated.
2. Add a GET branch for `type === 'combat_drafts'` that:
   - Requires DM auth (same pattern as `map_data_dm`, `timeline_dm`).
   - Returns `JSON.parse(value || '[]')`.
   - Returns `401` for non-DM requesters.
3. POST handler accepts an array payload and stores it as JSON. No
   server-side validation of draft shape beyond what other types do.
4. **No `dmNotes` / `dmDetail` stripping** — drafts are DM-only, never
   filtered, never returned to non-DM. Skip the player-view filtering branch
   for this key entirely.

### Edge cases

- **Two DM tabs open simultaneously.** Each tab's `pushState` does a
  read-modify-write of `allDrafts`. Last write wins; the two tabs may stomp
  on each other's draft updates. Acceptable risk — the existing
  `initiative_state` flow has the same property, and the DM realistically
  only runs combat from one tab.
- **Export Chronicle POST succeeds but draft-removal POST fails.** Result:
  duplicate combat in the chronicle on next manual recovery. Mitigation: do
  the draft-removal POST first, then the Chronicle POST? No — the Chronicle
  write is the truth source. Leave as-is; if removal fails, the next
  successful `pushState`/banner action will retry the removal. The discard
  button is always available as a fallback.
- **Page reload mid-combat.** On reload, `allDrafts` will contain an
  in-progress draft, the live `combatLog` will be empty, and `mode` will be
  reset to `'lobby'` by `init()`. The banner won't show (still in-progress,
  not pending-export). The draft sits invisible until either the DM starts a
  new combat (separate id; old one becomes an orphan) or 24h passes and
  auto-promote surfaces it. **This is acceptable** — the DM most likely
  resumes work in the new combat, and the orphan eventually appears.
- **Schema drift.** If a draft's `combatLog` shape changes in the future, old
  drafts may fail to load. Mitigation deferred — keep an eye on
  `snapshotCombatant` if it gets restructured.

## Test plan

No automated test framework. Manual verification via a real browser session:

- **Mid-combat persistence.** Start combat → apply damage / set notes →
  refresh page → confirm a draft with `status: 'in-progress'` exists in KV
  (devtools `fetch` or worker logs). Live combat state in the UI is reset
  (that's separate behavior; not in scope here).
- **End-without-export.** Start combat → end combat → close the carry-over
  modal without exporting → reload `initiative-dm.html` → banner appears
  with one entry.
- **Export from banner.** Click [Export] in banner → export modal opens
  pre-filled with the draft's HP table → "Add to Chronicle" → new entry in
  `timeline` → draft removed from KV → banner row gone.
- **Discard from banner.** Click [Discard] → confirm → draft removed from
  KV → banner row gone.
- **Multiple stacked drafts.** Run two combats without exporting → reload →
  banner shows both → export the first, discard the second, confirm both
  rows clear.
- **24h auto-promote.** Manually edit a draft's `savedAt` in KV to be > 24h
  old with `status: 'in-progress'`. Reload page. Confirm it now appears in
  the banner.
- **Player view isolation.** Throughout all of the above, open
  `initiative-player.html` and `map.html` as an anonymous user. Confirm
  there are no extra fields, no draft content leaks, no console errors. KV
  `initiative_state` shape must be unchanged.
- **Worker not redeployed.** With the new front-end code deployed but the
  worker still on the old version, confirm the page degrades gracefully
  (drafts simply never get saved or surfaced; no console explosion).

## Deployment notes

- Frontend changes (`initiative-dm.html`) ship via merge to `main` → GitHub
  Pages. Hard-refresh required.
- **Worker changes (`cloudflare-worker.js`) must be pasted into the
  Cloudflare dashboard manually.** Until that's done, the front-end POSTs
  will 401 and drafts won't persist. The page should not crash — the draft
  POST failure should be caught and silently swallowed (it's a non-critical
  sync).
- Add an entry to `CHANGELOG.md`.
