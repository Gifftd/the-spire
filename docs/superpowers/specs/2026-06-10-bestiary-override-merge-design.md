# Bestiary override merge — design

**Status:** design approved, awaiting implementation plan
**Date:** 2026-06-10
**Scope:** Make Crucible parsed-action overrides apply visibly through the Crucible, War Table, and Menagerie. Stop the "two Goblins in the picker" bug.

## Purpose

When the DM audits a parsed monster action in The Crucible (e.g., fixes a parser misclassification, sets `roleOverride: 'brute'`) and clicks **Save to bestiary_custom**, today's `saveOverride` writes a *partial* record into the `bestiary_custom` KV array. The Crucible's `loadBestiary` then concatenates `bestiary` and `bestiary_custom` as separate entries — producing two records with the same name in the picker: the original imported statblock plus a stub override record.

The DM expects their fix to *replace* the actions on the original monster everywhere — in the Crucible, the War Table picker, the Menagerie browser. This spec rewires the read path so override records overlay their imported base at load time. The KV write path is unchanged.

## Goals + non-goals

### In scope

- A shared `bestiary-merge.js` module exporting `mergeBestiaries(imported, custom)` that produces a single unified monster array. Override records (those with `overriddenAt`) layer onto their imported base by `name + source`. Homebrew records (no `overriddenAt`) append as-is. Orphan overrides (no matching imported base) append with a flag.
- Updates to the three consumers of the bestiary read path:
  - `crucible-dm.html` — `loadBestiary` uses the merge helper.
  - `initiative-dm.html` (War Table) — `loadBestiary` uses the merge helper.
  - `bestiary-dm.html` (Menagerie) — adds a unified `mergedMonsters` view for read-only paths (browser, filters, picker). Keeps existing `bestiary` + `customMonsters` lists for the editor's write paths.
- New test page `tests/bestiary-merge.test.html` with ~10 fixture-based assertions.

### Out of scope

- The Menagerie's own editing pattern (writes back to `bestiary` for imported monsters) stays as-is. Its re-import-clobber risk is a separate decision.
- Worker changes. The two existing endpoints (`?type=bestiary`, `?type=bestiary_custom`) keep their shapes. `DM_WRITE_TYPES` is unchanged.
- KV schema changes. No new keys, no new fields on stored records.
- Crucible's `saveOverride` shape. It still writes the same partial-override-record into `bestiary_custom`.

## Data model

### Record kinds in `bestiary_custom`

The KV array contains a mix of two record shapes, distinguished by the presence of `overriddenAt`:

```js
// Override record (written by Crucible's saveOverride):
{
  name: 'Owlbear',
  _source: 'mm-2024',
  parsedActions: [ ... ],     // optional
  regeneration: { ... },      // optional
  roleOverride: 'brute',      // optional
  overriddenAt: '2026-06-10T19:42:00.000Z',
}

// Homebrew record (written by Menagerie's editor — full statblock):
{
  name: 'Hag Lord',
  hp: 120, ac: 17,
  abilities: { ... },
  traits: [ ... ],
  actions: [ ... ],
  parsedActions: [ ... ],
  // no `overriddenAt`
}
```

**Discriminator:** `isOverrideRecord(m) === !!(m && m.overriddenAt)`.

### Match key

```js
function recordKey(m) {
  return (m && m.name || '') + '|' + (m && (m._source || m.source) || '');
}
```

Imported records use `m.source` (scrape pipeline convention). Override records use `m._source` (Crucible convention). The helper normalizes both.

### Merge result

The output array has three kinds of entries:

- **Plain imported** — `m.source` (or empty) lifted to `m._source`. No further changes.
- **Merged imported + override** — base imported record with override fields overlaid; `_overriddenAt` tag added so UI can surface "edited" state.
- **Homebrew** — passes through with `_custom: true` flag.
- **Orphan override** — override record with no matching imported base; passed through with `_orphanOverride: true` and `_custom: true` so the picker can show it for cleanup.

### Override fields applied

Constant exported from the module:

```js
OVERRIDE_FIELDS = ['parsedActions', 'regeneration', 'roleOverride'];
```

For each field: if the override record has it set to a non-null value, it wins; otherwise the imported base's value passes through unchanged. Explicit `null` is treated as "no override on this field" — never clobbers the base. This protects against malformed override records leaving the user with an empty `parsedActions` list.

## The merge function

```js
function mergeBestiaries(imported, custom) {
  const importedArr = arrayOf(imported);  // tolerates envelope or bare array
  const customArr   = arrayOf(custom);

  // Index override records by match key.
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
  const matched = new Set();
  for (const m of importedArr) {
    const key = recordKey(m);
    const ov  = overrideIdx.get(key);
    const merged = { ...m, _source: m._source || m.source || '' };
    if (ov) {
      matched.add(key);
      for (const field of OVERRIDE_FIELDS) {
        if (ov[field] !== undefined && ov[field] !== null) merged[field] = ov[field];
      }
      merged._overriddenAt = ov.overriddenAt;
    }
    out.push(merged);
  }

  // Orphan overrides — keep them visible so the DM can clean up.
  for (const [key, ov] of overrideIdx) {
    if (!matched.has(key)) {
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

`arrayOf(v)` tolerates both bare-array and envelope-`{monsters: [...]}` shapes — same logic that already lives inline in each loader today:

```js
function arrayOf(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.monsters)) return v.monsters;
  return [];
}
```

## Module API

```js
window.BestiaryMerge = {
  mergeBestiaries(imported, custom): MonsterArray,
  isOverrideRecord(m): boolean,
  recordKey(m): string,
  OVERRIDE_FIELDS: ['parsedActions', 'regeneration', 'roleOverride'],
};
```

Exposed via `window.BestiaryMerge` in browser; also exports `module.exports` for CommonJS — matches the pattern used by `crucible-engine.js` and `crucible-parser.js`.

## Integration

### `crucible-dm.html`

Add `<script src="bestiary-merge.js">` to the page head, before the existing `crucible-parser.js`/`crucible-engine.js` tags.

In `loadBestiary`, replace the two `for (const m of arr/cust)` loops at the bottom of the success branch with:

```js
const merged = BestiaryMerge.mergeBestiaries(imported, custom);
out.push(...merged);
```

The rest of `loadBestiary` (cache fallback, status flag, eager preload) is unchanged.

### `initiative-dm.html` (War Table)

Add the script tag to its head.

In its `loadBestiary` (around line 1188), find the concat:

```js
_BP.monsters = arr.concat(cust.map(m => ({ ...m, _custom: true })));
```

Replace with:

```js
_BP.monsters = BestiaryMerge.mergeBestiaries(imported, custom);
```

(Use the variables the existing code already extracts — `imported`, `custom`. The merge helper's tolerance for envelope/array shape means the existing local-variable juggling can stay or be simplified at the implementer's discretion.)

### `bestiary-dm.html` (Menagerie)

Add the script tag.

The Menagerie's editor needs to know each monster's *origin* (whether to write a save back to `bestiary` or `bestiary_custom`). So we **keep** the existing `bestiary` and `customMonsters` lists for the editor's purposes. We **add** a third merged view that the read-only paths use.

```js
// Keep existing extraction of bestiary + customMonsters for the editor.
bestiary       = imported;        // or { monsters: imported } per existing convention
customMonsters = custom;          // bare array

// Add the merged view for browser / filters / picker.
mergedMonsters = BestiaryMerge.mergeBestiaries(imported, customMonsters);
```

Update render/filter/list functions that currently iterate `bestiary.monsters + customMonsters` to iterate `mergedMonsters` instead. The editor's "Edit this monster" entry point still consults the origin lists (so it knows where to write).

Bonus side-effect: if a DM opens an imported monster in the Menagerie editor after the Crucible saved overrides for it, the editor sees the overridden `parsedActions` as part of the merged view. If the DM then saves edits via the Menagerie's editor, those edits are written to `bestiary` directly (existing behavior) — which makes the Crucible's override record now redundant. That's not a correctness issue (merge still works), but a future optimization could detect this and prune the redundant override.

### Caching

- Crucible: existing `delete window._CRUCIBLE_BESTIARY` in `saveOverride` triggers a re-fetch on next picker open. Merge runs again.
- War Table: existing `_BP.loaded` flag forces re-fetch on next picker open after sign-in.
- Menagerie: load-on-open pattern stays.

The merge function is linear in `imported.length + custom.length` and runs at fetch time. For typical KV sizes (~1500 imported + tens of overrides), runtime is well under 10 ms.

## Testing

### Unit tests — `tests/bestiary-merge.test.html`

New vanilla HTML test page following the existing harness pattern. Fixtures:

1. **Empty + empty** → `[]`. Null inputs tolerated.
2. **Imported only** — passthrough; `_source` normalized; record count matches.
3. **Homebrew only** — custom records without `overriddenAt` come through tagged `_custom: true`.
4. **Override matches imported** — base imported fields preserved; `parsedActions/regeneration/roleOverride` overlaid; `_overriddenAt` tag present.
5. **Orphan override** — no match by `name + source`; record appended with `_orphanOverride: true` and `_custom: true`.
6. **Partial override** — only `roleOverride` set; other override fields fall through to imported base unchanged.
7. **Cross-source distinctness** — MM Goblin and FM Goblin remain distinct; override on MM doesn't leak into FM.
8. **Multiple overrides** — each lands on its own base; no cross-contamination.
9. **Explicit null override field** — `parsedActions: null` is treated as "no override"; imported `parsedActions` survives.
10. **Mixed everything** — imported (10) + homebrew (3) + overrides matching 4 imported + 1 orphan → 14 total; 4 marked `_overriddenAt`; 1 marked `_orphanOverride`.

Plus three API-shape tests:

- `isOverrideRecord({overriddenAt: '...'})` → `true`
- `isOverrideRecord({hp:30, ac:14})` → `false`
- `recordKey({name:'Goblin', source:'mm-2024'})` === `recordKey({name:'Goblin', _source:'mm-2024'})`

### Manual UI checklist (added to CHANGELOG)

- [ ] In the Crucible, save a role override on an imported monster (set Owlbear to Brute). Refresh. The picker shows **one** Owlbear; opening Review shows `(currently: override)`.
- [ ] In the War Table picker, the same Owlbear shows up exactly once with override applied to its `parsedActions`.
- [ ] In the Menagerie browser, the same Owlbear shows once with overrides visible.
- [ ] Edit the Owlbear in the Menagerie's monster editor; the existing write-back-to-`bestiary` path still works.
- [ ] **Orphan check:** manually add an override record to `bestiary_custom` for a name that doesn't exist in `bestiary`. The Crucible picker shows it tagged as an orphan.
- [ ] **Backward compatibility:** existing pre-merge `bestiary_custom` records (saved before this change) work without manual intervention — they have `overriddenAt`, name, _source — so they merge correctly.

## Project discipline

- Per CLAUDE.md: snapshot touched files to `backups/<timestamp>-<desc>/` before each batch of edits.
- CHANGELOG.md entry added at the top of Unreleased with the manual UI checklist.
- Worker is **untouched**. No KV schema additions or migrations.
