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

  // ─────────── Pass 3 — Save effect ───────────
  const SAVE_RE_A = /DC\s+(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving\s+throw/i;
  const SAVE_RE_B = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving\s+throw[^.]*?DC\s+(\d+)/i;
  const HALF_RE   = /half(?:\s+as\s+much)?\s+damage\s+on\s+a\s+success(?:ful\s+save)?/i;
  const SHAPE_RE  = /(\d+)-foot[- ](sphere|cube|cone|line|radius)/i;
  const CONDITIONS = ['prone','restrained','grappled','stunned','paralyzed',
                      'frightened','incapacitated','unconscious','blinded',
                      'deafened','poisoned','charmed'];
  const ABILITY_3 = { strength:'str', dexterity:'dex', constitution:'con',
                      intelligence:'int', wisdom:'wis', charisma:'cha' };

  function aoeTargetsFromShape(body) {
    const m = body.match(SHAPE_RE);
    if (!m) return 1;
    const shape = m[2].toLowerCase();
    if (shape === 'sphere' || shape === 'cube')   return 4;
    if (shape === 'cone'   || shape === 'line')   return 3;
    if (shape === 'radius')                       return 2;
    return 1;
  }

  function detectCondition(body) {
    const low = body.toLowerCase();
    for (const c of CONDITIONS) {
      // word boundary to avoid matching "stunning" etc.
      const re = new RegExp('\\b' + c + '\\b', 'i');
      if (re.test(low)) return c;
    }
    return null;
  }

  function trySave(actionName, body) {
    let ability = null, dc = null;
    const a = body.match(SAVE_RE_A);
    if (a) { dc = parseInt(a[1], 10); ability = ABILITY_3[a[2].toLowerCase()]; }
    else {
      const b = body.match(SAVE_RE_B);
      if (b) { ability = ABILITY_3[b[1].toLowerCase()]; dc = parseInt(b[2], 10); }
    }
    if (!ability) return null;

    const dmgFail = extractDamage(body);
    const halfOnSave = HALF_RE.test(body);
    const cond = detectCondition(body);
    const hasDamage = dmgFail.length > 0;

    return {
      sourceActionName: actionName,
      kind: 'save',
      saveAbility: ability,
      saveDc: dc,
      aoeTargets: aoeTargetsFromShape(body),
      effectOnFail: hasDamage ? 'damage' : (cond ? 'condition' : 'damage'),
      damageOnFail: dmgFail,
      damageOnSave: halfOnSave ? dmgFail.map(d => ({ ...d, half:true })) : [],
      halfOnSave,
      condition: cond,
      parsedBy: 'auto',
      parsedAt: today(),
    };
  }

  // ─────────── Pass 3.5 — Heal effect ───────────
  const HEAL_DICE_RE = /regains?\s+(\d+)\s*\((\d+d\d+)(?:\s*\+\s*(\d+))?\)\s+hit\s+points/i;
  const HEAL_FLAT_RE = /regains?\s+(\d+)\s+hit\s+points/i;
  const SELF_RE   = /\b(?:itself|himself|herself|themselves|the\s+\w+(?:\s+\w+)?\s+regains)\b/i;
  const ALLY_RE   = /\b(?:one\s+creature|an?\s+ally|a\s+friendly\s+creature|its\s+ally)\b/i;
  const AOE_HEAL_RE = /\b(?:each\s+ally|all\s+allies|creatures?\s+within\s+\d+\s*(?:ft|feet|'))\b/i;
  const REVIVE_RE = /\b(?:0\s+hit\s+points|unconscious|dying)\b/i;

  function tryHeal(actionName, body) {
    const dice = body.match(HEAL_DICE_RE);
    const flat = !dice && body.match(HEAL_FLAT_RE);
    if (!dice && !flat) return null;

    let target = 'ally';
    if (AOE_HEAL_RE.test(body))   target = 'ally-aoe';
    else if (SELF_RE.test(body))  target = 'self';
    else if (ALLY_RE.test(body))  target = 'ally';

    const heal = dice
      ? { dice: dice[2], mod: dice[3] ? parseInt(dice[3], 10) : 0, flat: 0,
          target, aoeTargets: target === 'ally-aoe' ? aoeTargetsFromShape(body) : 0,
          reviveDowned: REVIVE_RE.test(body) }
      : { dice: null, mod: 0, flat: parseInt(flat[1], 10),
          target, aoeTargets: target === 'ally-aoe' ? aoeTargetsFromShape(body) : 0,
          reviveDowned: REVIVE_RE.test(body) };

    return {
      sourceActionName: actionName,
      kind: 'heal',
      heal,
      parsedBy: 'auto',
      parsedAt: today(),
    };
  }

  // ─────────── Recharge / uses-per-day ───────────
  // Always runs, attached to whatever Pass 1-3.5 produced.
  const RECHARGE_RE = /\(\s*Recharge\s+(\d)(?:\s*[-–]\s*(\d))?\s*\)/i;
  const USES_RE     = /\(\s*(\d+)\s*\/\s*Day\s*\)/i;

  function attachResourceGating(parsed, actionName) {
    if (!parsed) return parsed;
    const r = actionName.match(RECHARGE_RE);
    if (r) parsed.recharge = { dice: 'd6', minRoll: parseInt(r[1], 10) };
    else if (parsed.recharge === undefined) parsed.recharge = null;
    const u = actionName.match(USES_RE);
    if (u) parsed.usesPerDay = parseInt(u[1], 10);
    else if (parsed.usesPerDay === undefined) parsed.usesPerDay = null;
    return parsed;
  }

  // Master entry point.
  function parseAction(actionName, actionBody, monsterAbilities, monsterPb) {
    const body = actionBody || '';
    const p1 = tryMultiattack(actionName, body); if (p1) return attachResourceGating(p1, actionName);
    const p2 = tryAttack(actionName, body);      if (p2) return attachResourceGating(p2, actionName);
    const p3 = trySave(actionName, body);        if (p3) return attachResourceGating(p3, actionName);
    const p35 = tryHeal(actionName, body);       if (p35) return attachResourceGating(p35, actionName);
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
