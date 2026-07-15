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
  const WORD_NUM   = { a:1, an:1, one:1, two:2, three:3, four:4, five:5, six:6 };
  // "attacks twice", "uses X three times" — adverbial / times counts.
  const ADVERB_NUM = { once:1, twice:2, thrice:3 };

  function numFromWord(w) {
    if (!w) return 1;
    const k = w.toLowerCase();
    return ADVERB_NUM[k] || WORD_NUM[k] || 1;
  }

  // ── Multiattack plan resolution helpers (used post-parse) ──
  // Average of "NdM" (no modifier). Empty/invalid → 0.
  function diceAvg(dice) {
    const m = /^(\d+)d(\d+)$/i.exec(String(dice || ''));
    return m ? parseInt(m[1], 10) * (parseInt(m[2], 10) + 1) / 2 : 0;
  }
  // Rough average damage of a parsed action, for "best attack" selection.
  function actionAvgDamage(pa) {
    if (!pa) return 0;
    const list = pa.damage || pa.damageOnFail || [];
    let t = 0;
    for (const d of list) t += diceAvg(d.dice) + (Number(d.mod) || 0);
    return t;
  }
  // Normalize a name for fuzzy matching: lowercase, strip punctuation,
  // strip trailing plural 's' per word.
  function normName(s) {
    return String(s || '').toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/s\b/g, '');
  }
  // Match a candidate action name against a list of real names.
  // Case-insensitive, singular/plural, prefix, and word-subset. Returns the
  // matched real name or null.
  function fuzzyMatchName(candidate, names) {
    const c = normName(candidate);
    if (!c) return null;
    for (const n of names) if (normName(n) === c) return n;          // exact (normalized)
    for (const n of names) {                                         // prefix either way
      const nn = normName(n);
      if (nn && (nn.indexOf(c) === 0 || c.indexOf(nn) === 0)) return n;
    }
    const cw = c.split(' ').filter(Boolean);                         // all candidate words present
    for (const n of names) {
      const nn = normName(n);
      if (cw.length && cw.every(w => nn.split(' ').indexOf(w) !== -1)) return n;
    }
    return null;
  }

  // Does the body clearly lead into a multiattack? (Used when the action
  // isn't named "Multiattack".) Kept conservative so save/attack bodies that
  // merely mention "attack" don't get hijacked — extractMultiattackPlan is the
  // real filter, but a null plan here would skip the later passes.
  function multiattackBodyLead(body) {
    return /\bmakes\s+(?:a|an|one|two|three|four|five|six)\b[\s\S]{0,80}?\battacks?\b/i.test(body)
        || /\buses\s+[\w'’ -]+?\s+(?:once|twice|(?:two|three|four|five|six)\s+times|\btimes\b)/i.test(body)
        || /\battacks?\s+(?:once|twice|thrice|(?:two|three|four|five|six)\s+times?)\s+with\b/i.test(body);
  }

  // Extract a (possibly provisional) multiattack plan from a body. Provisional
  // entries carry `_chooseFrom:[names]` (pick best in post-pass) or
  // `actionName:null` (unnamed → monster's best attack). First form wins.
  // Strip a leading article/possessive so "its Claws" → "Claws".
  function cleanOpt(s) { return String(s || '').trim().replace(/^(?:its|his|her|their|the|a|an)\s+/i, '').trim(); }
  const GENERIC_ATTACK = /^(?:melee|ranged|weapon|spell)$/i;

  function extractMultiattackPlan(body) {
    // A) colon form: "makes N attacks: one with its X and one with its Y."
    const colon = body.match(/makes\s+(?:a|an|one|two|three|four|five|six)\s+attacks?\s*:\s*([^.]+)/i);
    if (colon) {
      const plan = [];
      for (const chunk of colon[1].split(/\s*(?:,|\band\b)\s*/i)) {
        const m = chunk.match(/(?:(a|an|one|two|three|four|five|six)\s+)?(?:with\s+(?:its|his|her|their)\s+)?([\w'’ -]+)/i);
        if (m && m[2] && m[2].trim()) plan.push({ actionName: m[2].trim(), count: m[1] ? WORD_NUM[m[1].toLowerCase()] : 1 });
      }
      if (plan.length) return plan;
    }
    // B0) generic "makes N melee/ranged/weapon attacks" (no named weapon) →
    // unnamed, resolved to the monster's best attack.
    const gen = body.match(/makes\s+(a|an|one|two|three|four|five|six)\s+(?:melee(?:\s+or\s+ranged)?|ranged(?:\s+or\s+melee)?|weapon)\s+attacks?\b/i);
    if (gen) return [{ actionName: null, count: WORD_NUM[gen[1].toLowerCase()] || 1 }];
    // B) "makes N attacks, using X or Y (or Z) in any combination" → choose-best-of
    const using = body.match(/makes\s+(a|an|one|two|three|four|five|six)\s+attacks?\b[^.]*?\b(?:using|with)\s+([^.]+?)\s+in\s+any\s+combination/i);
    if (using) {
      const opts = using[2].split(/\s*(?:,|\bor\b|\band\b)\s*/i).map(cleanOpt).filter(Boolean).filter(o => !GENERIC_ATTACK.test(o));
      if (opts.length >= 2) return [{ _chooseFrom: opts, count: WORD_NUM[using[1].toLowerCase()] || 1 }];
      if (opts.length === 1) return [{ actionName: opts[0], count: WORD_NUM[using[1].toLowerCase()] || 1 }];
    }
    // B1) "makes N X attacks or M Y attacks" — each side has its own count →
    // weighted choose-best-of (best of N×X vs M×Y by average damage).
    const orW = body.match(/makes\s+(a|an|one|two|three|four|five|six)\s+([\w'’ -]+?)\s+attacks?\s+or\s+(a|an|one|two|three|four|five|six)\s+([\w'’ -]+?)\s+attacks?\b/i);
    if (orW) {
      const opts = [
        { name: cleanOpt(orW[2]), count: WORD_NUM[orW[1].toLowerCase()] || 1 },
        { name: cleanOpt(orW[4]), count: WORD_NUM[orW[3].toLowerCase()] || 1 },
      ].filter(o => o.name && !GENERIC_ATTACK.test(o.name));
      if (opts.length) return [{ _chooseFromWeighted: opts }];
    }
    // B2) "makes N <X> or <Y> attacks" (shared count) → choose-best-of
    const orForm = body.match(/makes\s+(a|an|one|two|three|four|five|six)\s+([\w'’ -]+?\s+or\s+[\w'’ -]+?)\s+attacks?\b/i);
    if (orForm) {
      const count = WORD_NUM[orForm[1].toLowerCase()] || 1;
      const opts = orForm[2].split(/\s+or\s+/i).map(cleanOpt).filter(Boolean);
      const named = opts.filter(o => !GENERIC_ATTACK.test(o));
      if (named.length >= 2) return [{ _chooseFrom: named, count }];
      if (named.length === 1) return [{ actionName: named[0], count }];
      return [{ actionName: null, count }];   // all generic → best attack
    }
    // C) "makes N X attacks (and M Y attacks)*" (explicit named)
    {
      const re = /(?:makes\s+|and\s+)(a|an|one|two|three|four|five|six)\s+([\w'’ -]+?)\s+attacks?\b/gi;
      const plan = [];
      let m;
      while ((m = re.exec(body)) !== null) {
        const nm = m[2].trim();
        // skip bare/generic tokens — those are handled by the unnamed fallback.
        if (nm && !/^(?:more|other|additional|melee|ranged|weapon|spell)$/i.test(nm)) {
          plan.push({ actionName: nm, count: WORD_NUM[m[1].toLowerCase()] || 1 });
        }
      }
      if (plan.length) return plan;
    }
    // D) "uses <Name> N times" (e.g. beholder "uses Eye Rays three times")
    const usesT = body.match(/\buses\s+([\w'’ -]+?)\s+(once|twice|thrice|two|three|four|five|six)(?:\s+times?)?\b/i);
    if (usesT && usesT[1].trim()) return [{ actionName: usesT[1].trim(), count: numFromWord(usesT[2]) }];
    // E) "attacks N times with (its) <Name>"
    const tw = body.match(/\battacks?\s+(once|twice|thrice|two|three|four|five|six)(?:\s+times?)?\s+with\s+(?:its\s+|his\s+|her\s+|their\s+)?([\w'’ -]+)/i);
    if (tw && tw[2].trim()) return [{ actionName: tw[2].trim().replace(/[.,]+$/, ''), count: numFromWord(tw[1]) }];
    // F) bare "makes N attacks" (unnamed → monster's best attack)
    const bare = body.match(/makes\s+(a|an|one|two|three|four|five|six)\s+attacks?\b/i);
    if (bare) return [{ actionName: null, count: WORD_NUM[bare[1].toLowerCase()] || 1 }];
    return [];
  }

  function tryMultiattack(actionName, body) {
    const nameMatch = /^multiattack\b/i.test(actionName);
    if (!nameMatch) {
      if (!multiattackBodyLead(body)) return null;
      // Guard: an action NOT named "Multiattack" that carries its own attack
      // header or save-DC is an attack/save whose prose merely mentions making
      // an attack — don't hijack it (let tryAttack/trySave claim it). A genuine
      // unnamed multiattack (Frenzy/Rampage) has neither.
      if (ATTACK_HEADER_RE.test(body) || SAVE_RE_A.test(body) || SAVE_RE_B.test(body)) return null;
    }
    const plan = extractMultiattackPlan(body);
    if (!plan.length) return null;
    return {
      sourceActionName: actionName,
      kind: 'multiattack',
      multiattackPlan: plan,
      _raw: body,                 // retained so a plan that fails validation can degrade to unparsed
      parsedBy: 'auto',
      parsedAt: today(),
    };
  }

  // ─────────── Pass 2 — Attack roll ───────────
  // Header covers 2024 ("Melee Attack Roll:") and 2014 ("Melee Weapon Attack:")
  // and Spell Attack variants, and tolerates a "." terminator (some scrapes
  // render "Melee Weapon Attack. +7 to hit.").
  const ATTACK_HEADER_RE = /(Melee or Ranged|Melee|Ranged)\s+(?:(?:Weapon|Spell)\s+)?Attack(?:\s+Roll)?\s*[:.]/i;
  const TOHIT_RE   = /(?:Attack Roll|Attack)\s*:\s*([+-]?\d+)/i;
  const TOHIT_RE_B = /([+-]\d+)\s+to\s+hit\b/i;      // 2014 / headerless: "+7 to hit"
  const REACH_RE  = /reach\s+(\d+)\s*(?:ft|feet|')/i;
  const RANGE_RE  = /range\s+(\d+)(?:\s*\/\s*(\d+))?\s*(?:ft|feet|')/i;
  // Versatile alternative clause ("…or 8 (1d10 + 3) slashing damage if used
  // with two hands") — a single weapon, not extra damage. Stripped before
  // extraction so we don't double-count the two-handed profile.
  const VERSATILE_RE = /,?\s*or\s+(?:\d+\s*)?\(\d+d\d+(?:\s*[+-]\s*\d+)?\)\s+(?:[A-Za-z]+\s+)?damage\s+if\s+(?:used|wielded|held|holding|swung)\s+(?:in\s+two\s+hands|with\s+two\s+hands)/gi;
  // Damage component: optional leading average "11", then "(1d8 + 3)", then an
  // OPTIONAL type word, then "damage" (untyped when the type word is absent,
  // e.g. "7 (1d8 + 3) damage plus 28 (8d6) Fire damage").
  const DMG_RE    = /(?:\d+)?\s*\((\d+d\d+)(?:\s*([+-])\s*(\d+))?\)\s+(?:([A-Za-z]+)\s+)?damage/gi;

  function extractDamage(body) {
    const cleaned = String(body || '').replace(VERSATILE_RE, '');
    const out = [];
    let m;
    DMG_RE.lastIndex = 0;
    while ((m = DMG_RE.exec(cleaned)) !== null) {
      const dice = m[1];
      const sign = m[2] || '+';
      const num  = m[3] ? parseInt(m[3], 10) : 0;
      const mod  = sign === '-' ? -num : num;
      out.push({ dice, mod, type: (m[4] || 'untyped').toLowerCase() });
    }
    return out;
  }

  function tryAttack(actionName, body) {
    const headerMatch = body.match(ATTACK_HEADER_RE);
    const reachM = body.match(REACH_RE);
    const rangeM = body.match(RANGE_RE);
    // Headerless 2014 short form ("+8 to hit, reach 5 ft."): accept only when a
    // "+N to hit" and a reach/range are both present, so buff prose that merely
    // mentions "attack" doesn't get misread as a weapon attack.
    if (!headerMatch && !(TOHIT_RE_B.test(body) && (reachM || rangeM))) return null;
    const th  = body.match(TOHIT_RE);
    const thB = body.match(TOHIT_RE_B);
    // Distinguish melee vs ranged from the header (so spatial routing works even
    // when the body omits explicit "reach"/"range"); infer from reach/range for
    // the headerless form.
    const header = headerMatch ? headerMatch[0] : '';
    let actionRange = null;
    if (/Melee\s+or\s+Ranged/i.test(header))      actionRange = 'both';
    else if (/Ranged/i.test(header))              actionRange = 'ranged';
    else if (/Melee/i.test(header))               actionRange = 'melee';
    else if (reachM && rangeM)                    actionRange = 'both';
    else if (rangeM)                              actionRange = 'ranged';
    else if (reachM)                              actionRange = 'melee';
    const parsed = {
      sourceActionName: actionName,
      kind: 'attack',
      actionRange,
      toHit: th ? parseInt(th[1], 10) : (thB ? parseInt(thB[1], 10) : 0),
      reach: reachM ? parseInt(reachM[1], 10) : null,
      range: rangeM ? [parseInt(rangeM[1], 10), rangeM[2] ? parseInt(rangeM[2], 10) : null] : null,
      damage: extractDamage(body),
      parsedBy: 'auto',
      parsedAt: today(),
    };
    // v3.6: on-hit rider condition (attacks only). Only attached when detected,
    // so pure attacks stay byte-identical (rider stays undefined).
    const rider = detectRider(body);
    if (rider) parsed.rider = rider;
    return parsed;
  }

  // ─────────── Pass 3 — Save effect ───────────
  const SAVE_RE_A = /DC\s+(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving\s+throw/i;
  const SAVE_RE_B = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving\s+throw[^.]*?DC\s+(\d+)/i;
  // "half [as much] [damage] on a success[ful …]" — covers 2014 phrasings.
  const HALF_RE      = /\bhalf\b[^.]{0,40}?\bon\s+a\s+success/i;
  // 2024 outcome-clause phrasing: "Success: Half damage."
  const HALF_RE_2024 = /\bSuccess\s*:\s*Half\b/i;
  const SHAPE_RE  = /(\d+)-foot[- ](sphere|cube|cone|line|radius)/i;
  const CONDITIONS = ['prone','restrained','grappled','stunned','paralyzed',
                      'frightened','incapacitated','unconscious','blinded',
                      'deafened','poisoned','charmed'];
  const ABILITY_3 = { strength:'str', dexterity:'dex', constitution:'con',
                      intelligence:'int', wisdom:'wis', charisma:'cha' };

  // ─────────── v3.6 — on-hit rider condition (attacks only) ───────────
  // Detected inside tryAttack after damage extraction. Produces the v3.5
  // `rider` field { condition, saveAbility, saveDc, duration } consumed by
  // the engine's applyAttackRider on a hit. Checked in a fixed order; the
  // first pattern that matches wins.
  //   1. "the target is grappled (escape DC 14)"      → grappled, STR, DC 14
  //   2. "must succeed on a DC 13 Strength saving      → save-or-be-<cond>
  //       throw or be [knocked] <condition>"
  //   3. "the target has the <condition> condition"    → 2024 phrasing;
  //       DC (and save ability) pulled from a save clause elsewhere in the
  //       body, else saveDc:null so the engine derives it.
  const RIDER_GRAPPLE_RE = /\bgrappled\b[^.]*?\(\s*escape\s+DC\s+(\d+)\s*\)/i;
  const RIDER_SAVE_OR_RE = /DC\s+(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving\s+throw[^.]*?\bor\s+be\s+(?:knocked\s+)?(\w+)/i;
  const RIDER_HAS_RE     = /has\s+the\s+(\w+)\s+condition\b/i;

  // prone/grappled persist until actively cleared (stand-up / escape); other
  // rider conditions default to a single round.
  function riderDuration(cond) {
    return (cond === 'prone' || cond === 'grappled') ? 99 : 1;
  }

  function detectRider(body) {
    // 1. Escape-DC grapple phrasing.
    const g = body.match(RIDER_GRAPPLE_RE);
    if (g) {
      return { condition:'grappled', saveAbility:'str',
               saveDc: parseInt(g[1], 10), duration: 99 };
    }
    // 2. "…saving throw or be [knocked] <condition>".
    const s = body.match(RIDER_SAVE_OR_RE);
    if (s) {
      const cond = s[3].toLowerCase();
      if (CONDITIONS.includes(cond)) {
        return { condition: cond, saveAbility: ABILITY_3[s[2].toLowerCase()],
                 saveDc: parseInt(s[1], 10), duration: riderDuration(cond) };
      }
    }
    // 3. 2024 "the target has the <condition> condition".
    const h = body.match(RIDER_HAS_RE);
    if (h) {
      const cond = h[1].toLowerCase();
      if (CONDITIONS.includes(cond)) {
        // Pull DC + save ability from a save clause anywhere in the body.
        let dc = null, ability = 'con';
        const a = body.match(SAVE_RE_A);
        if (a) { dc = parseInt(a[1], 10); ability = ABILITY_3[a[2].toLowerCase()]; }
        else {
          const b = body.match(SAVE_RE_B);
          if (b) { ability = ABILITY_3[b[1].toLowerCase()]; dc = parseInt(b[2], 10); }
        }
        return { condition: cond, saveAbility: ability,
                 saveDc: dc, duration: riderDuration(cond) };
      }
    }
    return null;
  }

  // Shape nouns win over a bare "radius": 2024 phrasing is
  // "20-foot-radius sphere", where "radius" is part of the measurement, not
  // the shape. Match the noun (optionally preceded by "radius") first; fall
  // back to SHAPE_RE so radius-only bodies ("within a 30-foot radius") still
  // classify as radius.
  const SHAPE_NOUN_RE = /(\d+)-foot[- ](?:radius[- ]\s*)?(sphere|cube|cone|line)/i;

  function aoeTargetsFromShape(body) {
    const m = body.match(SHAPE_NOUN_RE) || body.match(SHAPE_RE);
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
    const halfOnSave = HALF_RE.test(body) || HALF_RE_2024.test(body);
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

  // ─────────── Pass 3.7 — Spellcasting (utility) ───────────
  // Innate/prepared spellcasting delegates its effect to named spells the sim
  // doesn't model. Classify as `utility` (not `unparsed`) so it neither blocks
  // the validation gate nor litters Review with red. Runs AFTER multiattack so
  // "…and can use Spellcasting to cast X" multiattacks stay multiattacks.
  //   "casts one of the following spells…" / "casts Fire Bolt" / "casts the
  //   Entangle spell" / "casts Counterspell in response…"
  const SPELLCAST_RE = /\b[Cc]asts\s+(?:one\s+of\s+the\s+following|the\s+[A-Z]|[A-Z][A-Za-z'’]+)/;

  function trySpellcasting(actionName, body) {
    if (!/spellcasting/i.test(actionName) && !SPELLCAST_RE.test(body)) return null;
    return {
      sourceActionName: actionName,
      kind: 'utility',
      _note: 'spellcasting — effect delegated to named spells (not simulated)',
      parsedBy: 'auto',
      parsedAt: today(),
    };
  }

  // ─────────── Pass 3.8 — Non-combat utility ───────────
  // Movement / positioning / shape-shift actions with no damage or healing.
  // Runs last before the unparsed fallback (so any combat mechanic already had
  // its chance). Refuses when the body deals dice damage or heals, keeping
  // those visible for DM review rather than silently zeroing them.
  const UTIL_RES = [
    /\bteleports?\b/i,
    /\b(?:jumps?|leaps?)\b/i,
    /\bshape-?shifts?\b/i,
    /\breturns?\s+to\s+its\s+true\s+form\b/i,
    /\btakes\s+the\s+(?:Dash|Disengage|Hide|Dodge)\b/i,
    /\b(?:Dash|Disengage|Hide|Dodge)(?:,|\s+or\s+|\s+and\s+)/i,
    /\bmoves?\s+up\s+to\s+(?:its|half)\b/i,
  ];

  function tryUtility(actionName, body) {
    if (/\(\d+d\d+/i.test(body)) return null;         // has dice damage → keep for review
    if (/hit\s+points\b/i.test(body)) return null;    // healing/HP change → keep for review
    for (const re of UTIL_RES) {
      if (re.test(body)) {
        return {
          sourceActionName: actionName,
          kind: 'utility',
          _note: 'non-combat action (movement/positioning; not simulated)',
          parsedBy: 'auto',
          parsedAt: today(),
        };
      }
    }
    return null;
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

  // Master entry point. First match wins; order matters (multiattack before
  // spellcasting so "…uses Spellcasting…" multiattacks aren't stolen; utility
  // last so any combat mechanic is preferred).
  function parseAction(actionName, actionBody, monsterAbilities, monsterPb) {
    const body = actionBody || '';
    const p1 = tryMultiattack(actionName, body);  if (p1) return attachResourceGating(p1, actionName);
    const p2 = trySpellcasting(actionName, body); if (p2) return attachResourceGating(p2, actionName);
    const p3 = tryAttack(actionName, body);       if (p3) return attachResourceGating(p3, actionName);
    const p4 = trySave(actionName, body);         if (p4) return attachResourceGating(p4, actionName);
    const p5 = tryHeal(actionName, body);         if (p5) return attachResourceGating(p5, actionName);
    const p6 = tryUtility(actionName, body);      if (p6) return attachResourceGating(p6, actionName);
    return unparsed(actionName, body);
  }

  // ─────────── parseRegeneration (trait body → block | null) ───────────
  const REGEN_NAME_RE   = /^regeneration\b/i;
  const REGEN_AMOUNT_RE = /regains\s+(\d+)\s+hit\s+points/i;
  const REGEN_SUPPRESS_RE = /take(?:n)?\s+([\w,\s]+?)\s+damage\b/i;
  const KNOWN_DAMAGE_TYPES = ['acid','fire','cold','lightning','thunder','poison',
    'necrotic','radiant','psychic','force','bludgeoning','piercing','slashing'];

  function parseRegeneration(traits) {
    if (!Array.isArray(traits)) return null;
    const t = traits.find(x => x && REGEN_NAME_RE.test(x.name || ''));
    if (!t) return null;
    const am = (t.body || '').match(REGEN_AMOUNT_RE);
    if (!am) return null;
    const supp = [];
    const sm = (t.body || '').match(REGEN_SUPPRESS_RE);
    if (sm) {
      const parts = sm[1].toLowerCase().split(/\s*(?:,|\bor\b|\band\b)\s*/);
      for (const p of parts) {
        const cleaned = p.trim();
        if (KNOWN_DAMAGE_TYPES.includes(cleaned)) supp.push(cleaned);
      }
    }
    return { amount: parseInt(am[1], 10), suppressedBy: supp, minHpToRegen: 1 };
  }

  // ─────────── Multiattack plan resolution (post-parse) ───────────
  // Runs once all of a monster's actions are parsed, so sibling action names +
  // their damage are available. For each auto-parsed multiattack:
  //   • `_chooseFrom:[…]` → pick the highest-damage valid option.
  //   • `actionName:null`  → the monster's best (highest-damage) attack.
  //   • explicit names     → fuzzy-validated against real sibling names.
  // Invalid entries are dropped. Duplicate names are merged (counts summed). If
  // nothing valid remains, the multiattack degrades to `unparsed` rather than
  // emitting a plan that references non-existent actions.
  function resolveMultiattackPlans(monster) {
    const all = Array.isArray(monster.parsedActions) ? monster.parsedActions : [];
    const usable = all.filter(pa => pa.kind !== 'multiattack' && pa.kind !== 'unparsed');
    const names = usable.map(pa => pa.sourceActionName);
    const byName = {};
    for (const pa of all) byName[pa.sourceActionName] = pa;
    const attacks = all.filter(pa => pa.kind === 'attack');
    const bestAttack = attacks.slice().sort((a, b) => actionAvgDamage(b) - actionAvgDamage(a))[0];
    const avgOf = nm => actionAvgDamage(byName[nm]);

    for (const pa of all) {
      if (pa.kind !== 'multiattack' || !Array.isArray(pa.multiattackPlan)) continue;
      if (pa.parsedBy === 'manual') continue;   // don't second-guess DM-authored plans
      const resolved = [];
      for (const step of pa.multiattackPlan) {
        if (step._chooseFromWeighted) {
          // Pick the option maximizing count × per-attack average damage.
          const valid = step._chooseFromWeighted
            .map(o => ({ name: fuzzyMatchName(o.name, names), count: o.count }))
            .filter(o => o.name);
          if (valid.length) {
            valid.sort((a, b) => (b.count * avgOf(b.name)) - (a.count * avgOf(a.name)));
            resolved.push({ actionName: valid[0].name, count: valid[0].count });
          }
        } else if (step._chooseFrom) {
          let cands = step._chooseFrom.map(o => fuzzyMatchName(o, names)).filter(Boolean);
          cands = cands.filter((v, i) => cands.indexOf(v) === i);
          if (cands.length) {
            cands.sort((a, b) => avgOf(b) - avgOf(a));
            resolved.push({ actionName: cands[0], count: step.count });
          }
        } else if (step.actionName == null) {
          if (bestAttack) resolved.push({ actionName: bestAttack.sourceActionName, count: step.count });
        } else {
          const match = fuzzyMatchName(step.actionName, names);
          if (match) resolved.push({ actionName: match, count: step.count });
        }
      }
      // Merge duplicate names (sum counts), preserving first-seen order.
      const merged = [];
      for (const s of resolved) {
        const ex = merged.find(x => x.actionName === s.actionName);
        if (ex) ex.count += s.count; else merged.push({ actionName: s.actionName, count: s.count });
      }
      if (merged.length) {
        pa.multiattackPlan = merged;
        delete pa._raw;
      } else {
        // Degrade in place to unparsed (keeps the gate honest + shows in Review).
        const raw = pa._raw || '';
        pa.kind = 'unparsed';
        pa._raw = raw;
        delete pa.multiattackPlan;
      }
    }
  }

  // ─────────── parseAllMonsterActions (memoized) ───────────
  // Walks actions[] / bonusActions[] / reactions[], parses each, populates
  // monster.parsedActions[]. If an entry already exists for a given
  // sourceActionName (e.g. from a bestiary_custom override), keep it.
  // Also writes monster.regeneration if a Regeneration trait is present
  // and not already set.
  function parseAllMonsterActions(monster) {
    if (!monster) return;
    monster.parsedActions = Array.isArray(monster.parsedActions) ? monster.parsedActions : [];
    const existing = new Set(monster.parsedActions.map(p => p.sourceActionName));
    const buckets = [
      ['action', monster.actions],
      ['bonus', monster.bonusActions],
      ['reaction', monster.reactions],
    ];
    for (const [costLabel, arr] of buckets) {
      if (!Array.isArray(arr)) continue;
      for (const a of arr) {
        if (!a || !a.name || existing.has(a.name)) continue;
        const p = parseAction(a.name, a.body, monster.abilities, monster.pb);
        p.cost = costLabel;
        monster.parsedActions.push(p);
        existing.add(a.name);
      }
    }
    resolveMultiattackPlans(monster);
    if (!monster.regeneration) {
      const r = parseRegeneration(monster.traits);
      if (r) monster.regeneration = r;
    }
  }

  // ─────────── Public exports ───────────
  const CrucibleParser = {
    parseAction,
    parseRegeneration,
    parseAllMonsterActions,
    _today: today,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CrucibleParser;
  else root.CrucibleParser = CrucibleParser;
})(typeof window !== 'undefined' ? window : globalThis);
