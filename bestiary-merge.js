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
