// ═══════════════════════════════════════════════════════════════════════
//  crucible-parser.js
//  Pure functions: parseAction, parseRegeneration, parseAllMonsterActions.
//  Five passes. First match wins. Loaded by crucible-dm.html and
//  tests/parser.test.html.
// ═══════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  // Today's date for `parsedAt` provenance.
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // ─────────── Pass 4 — Unparsed fallback ───────────
  // Always available. Wraps an action body in an explicit "couldn't
  // parse this" marker. The sim treats kind:'unparsed' as skip-and-flag,
  // and the validation gate refuses to run a sim until they're resolved.
  function unparsed(actionName, actionBody) {
    return {
      sourceActionName: actionName,
      kind: 'unparsed',
      _raw: actionBody || '',
      parsedBy: 'auto',
      parsedAt: today(),
    };
  }

  // Master entry point. For now, this always returns the unparsed
  // fallback — subsequent tasks add Passes 1, 2, 3, 3.5, and the
  // recharge/uses extractor in front of it.
  function parseAction(actionName, actionBody, monsterAbilities, monsterPb) {
    return unparsed(actionName, actionBody);
  }

  // ─────────── Public exports ───────────
  const CrucibleParser = {
    parseAction,
    _today: today,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CrucibleParser;
  else root.CrucibleParser = CrucibleParser;
})(typeof window !== 'undefined' ? window : globalThis);
