# Initiative Tracker — Player Notes (combat-scoped)

**Status:** Design approved, ready for implementation plan
**Date:** 2026-06-10
**Branch:** `feature/initiative-player-notes`

---

## 1. Goal

Let players attach short text notes to any combatant during combat — themselves,
party members, enemies, NPCs. Notes are tactical scratchpad for the current
encounter (e.g., "resistant to fire", "owes me 20gp", "wearing red sash"). They
go away when the encounter ends.

## 2. Scope decisions

These were settled during brainstorming and are not revisited here.

| Decision | Choice | Why |
|---|---|---|
| Lifetime | **Combat-scoped only** | Lives inside the existing `initiative_state` blob; dies naturally on combat reset. Persistent character/NPC notes are a separate future feature. |
| Visibility | **Per-note: private (just author) or party (all logged-in players + DM). DM always sees everything.** | Covers "my own observations" and "hey party, watch out". DM-always-sees is consistent with the rest of the app. |
| Authoring | **Players only.** DM is read-only. | Smallest UI footprint in the 2300-line DM tracker. DM already has the `notes` field + whispers for their own channels. |
| UI shape | **Inline expand on each row, with one note preview visible on the collapsed card.** | Matches existing row-based glanceable layout. Preview keeps the most recent intel visible without a click. |

## 3. Data model

A new field `playerNotes: []` is added to each combatant inside the existing
`initiative_state.combatants[i]`. The existing string field `notes` (DM's
"Secret notes…" scratchpad) is untouched.

**Note shape:**

```js
{
  id: "n_abc123",         // uid for delete operations
  combatantId: "c_xyz",   // the combatant.id it's pinned to
  authorCharId: "char_1", // validated by worker against characters list
  authorName: "Lyra",     // denormalized so deleted/renamed chars still show right
  body: "Resistant to fire",
  visibility: "party",    // 'private' | 'party'
  createdAt: 1733871234567 // ms epoch
}
```

**Constraints:**

- `body` capped at 500 characters (enforced client + server).
- Per-character cap of 50 notes per encounter (defense against runaway loops).
- Notes sorted newest-first when rendered.

## 4. Worker changes

Requires manual redeploy via Cloudflare dashboard (per the repo's existing worker
deploy process).

### 4.1 New POST types

Player auth follows the existing precedent from the `brew` POST handler
(`cloudflare-worker.js` line 591): creds live in the JSON body as
`body.characterId` + `body.code`. The worker re-validates by looking up the
character and comparing the stored code. DM auth (via existing `verifyDMAuth`
on `X-DM-User` / `X-DM-Pass` headers) is also accepted as an override.

| Type | Body | Auth | Behavior |
|---|---|---|---|
| `initiative_note` | `{ characterId, code, combatantId, body, visibility }` | `body.characterId` + `body.code` (validated against `characters` KV). | Re-resolve `authorName` server-side from the looked-up character (don't trust client). Read `initiative_state`, append new note to `combatants[i].playerNotes`, write back. Reject if combatant not found (404), body too long (400), or per-character cap reached (400). |
| `initiative_note_delete` | `{ characterId?, code?, combatantId, noteId }` | Player creds **OR** DM headers. | If player creds provided and validate: only allowed if note's `authorCharId === characterId`. If DM creds present (and player creds absent or invalid): allowed for any note. Remove from array, write back. |

Add both to a new `PLAYER_WRITE_TYPES` list parallel to the existing
`DM_WRITE_TYPES`. Implement a small helper `verifyCharacterAuth(body, env)`
(takes the parsed body, looks up the character by `body.characterId`, compares
to `body.code`, returns `{ok, character}`). This mirrors the inline validation
already done in `character_login` / `brew` and centralizes it for reuse.

### 4.2 GET `initiative_state` — add filtering

Currently returns the full blob unfiltered. Replace with three branches.
Credentials are passed following the existing precedent from `timeline_view`
/ `npc_roster`: player creds via URL query params (`?type=initiative_state
&characterId=…&code=…`), DM creds via `X-DM-*` headers. If query params are
absent and DM headers are absent, viewer is anonymous. If query params are
present but invalid, return 401 (do **not** silently fall back to anonymous —
that would be confusing for a player whose creds were rotated).

| Viewer | What they get |
|---|---|
| DM (DM headers valid) | Full unfiltered blob. Sees `notes` (DM secret), all `playerNotes`, and hidden combatants. |
| Logged-in player (query creds valid) | Hidden combatants dropped entirely. For each remaining combatant: strip `notes` string; include `playerNotes` where `visibility === 'party'` OR `authorCharId === viewer's characterId`. |
| Anonymous (no creds) | Hidden combatants dropped entirely. For each remaining combatant: strip `notes` string; include `playerNotes` where `visibility === 'party'`. |

Implement as a sibling helper `filterInitiativeState(state, viewer)` modeled on
the existing `filterForCharacter`. The `viewer` argument is `{role: 'dm'}`,
`{role: 'player', characterId}`, or `null`.

### 4.3 Existing data leaks fixed as part of this change

The new filter incidentally closes two pre-existing leaks in the player payload.
**Do not skip them** — they're trivial additions to a filter we're already
building, and without them the new feature ships alongside the same bugs.

1. **`combatant.notes` string** ("Secret notes…", intended DM-only). Today it
   is shipped to every player browser as raw JSON. The new filter strips it
   from all non-DM viewers.
2. **`combatant.hidden` enemies** (the DM tracker has an "Add as hidden"
   checkbox at line 543 of `initiative-dm.html`, and combatants get a `hidden:
   true` flag at line 974). Today these are returned to players and rendered
   in their initiative list. The new filter drops them entirely from non-DM
   payloads. Notes attached to hidden combatants are therefore also never sent.

Neither leak is "fixed" in a way that requires migration — the data shape stays
the same, only the filter changes.

### 4.4 Concurrency

Notes live in the same KV key the DM updates for HP/conditions/init. Last-write
wins. The worker does a tight read-modify-write server-side (~10ms window), so
the realistic collision rate at table scale (4–5 players, occasional posts) is
negligible. Accepted risk, documented here. If it ever becomes a real problem,
the migration path is a separate `initiative_notes` KV key.

## 5. Player UI (`initiative-player.html`)

### 5.1 Identity

The page currently polls anonymously. It must support both modes:

- **Anonymous viewer:** can read party-visible notes. Cannot write or delete.
  A small banner at the top reads "Log in as your character to add notes →
  [Log in]". Tapping the button opens the existing `character_login` modal
  (lifted from `home.html`, reused via a shared helper if practical, otherwise
  re-implemented in this page using the same `Auth` module).
- **Logged-in player:** uses their character creds on writes. Sees their own
  private notes plus everyone's party-visible notes. The login banner is
  replaced with a small "Signed in as <Name> · Log out" chip.

Auth state is held by the existing `Auth` module in `auth.js` — already loaded
on this page (line 209) but currently unused.

### 5.2 Collapsed row (with note preview)

Below the existing row content, a single-line preview appears **only if** the
viewer has ≥1 visible note on that combatant:

```
┌───────────────────────────────────────────────────────┐
│  18   ● Goblin Captain                  CONDITION  AC │
│         📝 ×3  "Resistant to fire — Lyra"     ████░░  │
└───────────────────────────────────────────────────────┘
```

- Preview text = most-recent visible note's body, truncated to ~60 chars + ellipsis.
- `×N` count = number of notes visible to *this* viewer.
- Author name appended ("— Lyra") so it's clear who said it without expanding.
- The whole row remains tappable to expand.

### 5.3 Expanded row

Tapping a row toggles its expanded state. Only one row can be expanded at a
time — opening a new one collapses the previous. The expanded panel pushes other
rows down inline (no overlays/modals — mobile-friendly).

Expanded layout:

```
┌───────────────────────────────────────────────────────┐
│  [row header — same as collapsed]                     │
│  ───────────────────────────────────────────────────  │
│   ┌─────────────────────────────────────────────┐    │
│   │ Resistant to fire                  [PARTY]  │    │
│   │ Lyra · just now                             │    │
│   └─────────────────────────────────────────────┘    │
│   ┌─────────────────────────────────────────────┐    │
│   │ Owes me 20gp                    [PRIVATE] × │    │
│   │ you · 2 min ago                             │    │
│   └─────────────────────────────────────────────┘    │
│   ─────────────────────────────────────────────       │
│   [ Add a note…                              ]        │
│   ( ) Just me   (•) Party                  [Save]     │
└───────────────────────────────────────────────────────┘
```

- Notes sorted newest first.
- Per note: body (rendered via `textContent`, never `innerHTML`), visibility chip,
  author + relative time, delete "×" **only on notes the viewer authored**.
- Add-note form: textarea (max 500 chars, soft counter visible when ≥ 400),
  visibility radio (`private | party`, default = last choice the user made,
  persisted in `localStorage` under `spire-initiative-note-vis`), Save button.
- "you" replaces author name on your own notes for compactness.
- Relative time computed client-side from `createdAt` (`just now` < 60s,
  `Nm ago` < 60min, `Nh ago` < 24h, then date).
- Anonymous viewers see the list but the form is replaced with the login banner
  from §5.1.

### 5.4 Live updates

The existing 2.5s poll picks up new notes automatically. When the player is
logged in, the poll URL gains `&characterId=…&code=…` query params (so the
worker filter returns their private notes too). When anonymous, the URL stays
unparameterized.

On note submit:

1. Optimistically render the new note locally with `pending` flag (slightly faded).
2. POST to worker with `{type: 'initiative_note', characterId, code, combatantId, body, visibility}`.
3. On 2xx: clear `pending`, refresh on next poll tick.
4. On error: show inline toast "Couldn't save note — retry?", keep textarea content,
   auto-retry once on next poll. After second failure, give up and require manual retry.

On note delete:

1. Optimistically remove from local state.
2. POST `{type: 'initiative_note_delete', characterId, code, combatantId, noteId}`.
3. On error: restore the note, show toast.

## 6. DM UI (`initiative-dm.html`)

Single read-only section added to the existing combatant-card expanded panel,
below the existing "Secret notes" textarea:

```
📝 Player notes (3)
 • "Resistant to fire" — Lyra · PARTY · 2m ago
 • "Owes me 20gp" — Lyra · PRIVATE · 5m ago
 • "Wearing red sash" — Garruk · PARTY · 8m ago
```

- Hidden entirely when there are 0 notes (no empty-state noise).
- DM sees **all** notes including private ones. Visibility chip always shown so
  the DM knows what the party can see.
- No add/edit UI for the DM in v1. (Worker accepts DM creds on
  `initiative_note_delete` so moderation is technically possible via curl, but
  not exposed in the UI — out of scope for v1.)

## 7. Error handling

| Scenario | Behavior |
|---|---|
| Worker 5xx / offline on post | Inline toast "Couldn't save — retry?". Keep textarea content. Auto-retry once on next poll tick. |
| Combatant deleted between viewing and posting | Worker → 404. UI: "That combatant is no longer in the encounter." Keep textarea content. |
| Character creds rejected (codes rotated) | Worker → 401. Clear local auth. Fall back to anonymous banner. |
| Body > 500 chars | Client: Save button disabled, counter red. Server: 400 as defense in depth. |
| Per-character cap (50 notes) reached | Worker → 400 with specific error. UI shows "Note limit reached for this encounter." |
| Combat reset (DM clears, mode → lobby) | All notes vanish with the encounter. Player view shows lobby screen as today. Working as designed. |
| Player posts during DM HP edit | Last-write-wins. Accepted risk per §4.4. |
| Hidden enemies | Per §4.3, `filterInitiativeState` drops hidden combatants from non-DM payloads. Notes attached to them are therefore also never sent. (This is new behavior — today hidden enemies leak; see §4.3.) |
| Author character deleted after writing note | `authorName` is denormalized in the note; the note still displays correctly with the original name. |
| XSS via note body | All bodies rendered via `textContent`. No HTML in notes. |

## 8. Out of scope (explicit YAGNI)

The following are deliberately deferred:

- Editing notes after creation (delete + re-add covers this for v1).
- Note threading / replies.
- Notes attached to the encounter as a whole, rather than per-combatant.
- Persistent notes that survive combat (would live on `characters` / `npcs`).
- DM-authored notes that broadcast to players (use whispers / journal).
- Rich text, markdown, @-mentions, links.
- Search or filter notes.
- Push / sound / visual notifications when a new note arrives.
- Note history / audit log.

## 9. File touch list

| File | Change |
|---|---|
| `cloudflare-worker.js` | New `verifyCharacterAuth`; new `PLAYER_WRITE_TYPES` list; handlers for `initiative_note` + `initiative_note_delete`; new `filterInitiativeState`; rewrite GET `initiative_state` to use it. **Requires manual redeploy.** |
| `initiative-player.html` | Wire up `Auth` module use; render preview line on collapsed rows; render expanded notes panel with add/delete; login banner for anonymous; optimistic update + retry logic. Bulk of the UI work lives here. |
| `initiative-dm.html` | Add read-only "Player notes" section to existing combatant-card expanded panel. Small change in a large file — keep it localized. |
| `CHANGELOG.md` | New entry under Unreleased. Per repo conventions. |
| (no new files) | Notes ride entirely on existing `initiative_state` KV blob. No new KV keys. |

## 10. Deploy notes

Per repo conventions (`CLAUDE.md`):

1. Snapshot touched files into `backups/<timestamp>-initiative-notes/` before editing.
2. Cloudflare Worker change requires manual paste into the Cloudflare dashboard
   (Workers & Pages → `dnd-perk-webhook` → Edit code → Save and deploy).
   **Until the worker is redeployed, the new UI will fail on every write** (no
   `initiative_note` handler exists). Frontend + worker deploys must happen
   together.
3. GitHub Pages serves the frontend from `main` automatically; CDN caches
   aggressively — hard-refresh (Cmd+Shift+R) after deploy.
4. Add a CHANGELOG entry.
