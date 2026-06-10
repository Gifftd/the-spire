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

  // Merge imported + custom into a unified monster list.
  // - Override records (overriddenAt set) overlay their imported base by
  //   name+source. Non-null override fields win; nulls/undefined fall through.
  // - Homebrew records (no overriddenAt) pass through tagged `_custom:true`.
  // - Orphan overrides (no matching imported base) are appended tagged
  //   `_orphanOverride:true` so the DM can spot/clean them in the picker.
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

  // ─────────── Public exports ───────────
  const BestiaryMerge = {
    OVERRIDE_FIELDS,
    isOverrideRecord,
    recordKey,
    arrayOf,
    mergeBestiaries,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BestiaryMerge;
  else root.BestiaryMerge = BestiaryMerge;
})(typeof window !== 'undefined' ? window : globalThis);
