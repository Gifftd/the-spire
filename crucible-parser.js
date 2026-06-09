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

  // ─────────── Pass 1 — Multiattack detection ───────────
  const WORD_NUM = { a:1, an:1, one:1, two:2, three:3, four:4, five:5, six:6 };

  function tryMultiattack(actionName, body) {
    const nameMatch = /^multiattack\b/i.test(actionName);
    const bodyLead  = /^the\s+\w+(?:[ \w'-]+)?\s+makes\s+(a|an|one|two|three|four|five|six)\s+/i.test(body);
    if (!nameMatch && !bodyLead) return null;

    const plan = [];
    // Pattern A: "makes <num> X attacks" — possibly chained with "and <num> Y attacks"
    // Also handles "makes <num> attacks: one with its X and one with its Y"
    const colonForm = body.match(/makes\s+(?:a|an|one|two|three|four|five|six)\s+attacks?\s*:\s*(.+?)\./i);
    if (colonForm) {
      // Split the tail on " and " / commas. Each chunk is
      // "<num> with its <Name>" or "with its <Name>".
      const chunks = colonForm[1].split(/\s*(?:,|\band\b)\s*/i);
      for (const chunk of chunks) {
        const m = chunk.match(/(?:(a|an|one|two|three|four|five|six)\s+)?(?:with\s+(?:its|his|her|their)\s+)?([\w' -]+)/i);
        if (m) {
          const count = m[1] ? WORD_NUM[m[1].toLowerCase()] : 1;
          plan.push({ actionName: m[2].trim(), count });
        }
      }
    } else {
      // Pattern B: "makes <num> X attacks (and <num> Y attacks)*"
      const re = /(?:makes\s+|and\s+)(a|an|one|two|three|four|five|six)\s+([\w' -]+?)\s+attacks?\b/gi;
      let m;
      while ((m = re.exec(body)) !== null) {
        plan.push({
          actionName: m[2].trim(),
          count: WORD_NUM[m[1].toLowerCase()] || 1,
        });
      }
    }

    if (!plan.length) return null;
    return {
      sourceActionName: actionName,
      kind: 'multiattack',
      multiattackPlan: plan,
      parsedBy: 'auto',
      parsedAt: today(),
    };
  }

  // ─────────── Pass 2 — Attack roll ───────────
  const ATTACK_HEADER_RE = /(?:Melee or Ranged Attack Roll|Melee Attack Roll|Ranged Attack Roll|Melee Weapon Attack|Ranged Weapon Attack)\s*:/i;
  const TOHIT_RE  = /(?:Attack Roll|Attack)\s*:\s*([+-]?\d+)/i;
  const REACH_RE  = /reach\s+(\d+)\s*(?:ft|feet|')/i;
  const RANGE_RE  = /range\s+(\d+)(?:\s*\/\s*(\d+))?\s*(?:ft|feet|')/i;
  // Damage component: optional leading average "11", then "(1d8 + 3)" then "Type damage"
  const DMG_RE    = /(?:\d+)?\s*\((\d+d\d+)(?:\s*([+-])\s*(\d+))?\)\s+([A-Za-z]+)\s+damage/gi;

  function extractDamage(body) {
    const out = [];
    let m;
    DMG_RE.lastIndex = 0;
    while ((m = DMG_RE.exec(body)) !== null) {
      const dice = m[1];
      const sign = m[2] || '+';
      const num  = m[3] ? parseInt(m[3], 10) : 0;
      const mod  = sign === '-' ? -num : num;
      out.push({ dice, mod, type: m[4].toLowerCase() });
    }
    return out;
  }

  function tryAttack(actionName, body) {
    if (!ATTACK_HEADER_RE.test(body)) return null;
    const th = body.match(TOHIT_RE);
    const reachM = body.match(REACH_RE);
    const rangeM = body.match(RANGE_RE);
    return {
      sourceActionName: actionName,
      kind: 'attack',
      toHit: th ? parseInt(th[1], 10) : 0,
      reach: reachM ? parseInt(reachM[1], 10) : null,
      range: rangeM ? [parseInt(rangeM[1], 10), rangeM[2] ? parseInt(rangeM[2], 10) : null] : null,
      damage: extractDamage(body),
      parsedBy: 'auto',
      parsedAt: today(),
    };
  }

  // Master entry point.
  function parseAction(actionName, actionBody, monsterAbilities, monsterPb) {
    const body = actionBody || '';
    const p1 = tryMultiattack(actionName, body); if (p1) return p1;
    const p2 = tryAttack(actionName, body);      if (p2) return p2;
    return unparsed(actionName, body);
  }

  // ─────────── Public exports ───────────
  const CrucibleParser = {
    parseAction,
    _today: today,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CrucibleParser;
  else root.CrucibleParser = CrucibleParser;
})(typeof window !== 'undefined' ? window : globalThis);
