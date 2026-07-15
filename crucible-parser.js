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
  const WORD_NUM   = { a:1, an:1, one:1, two:2, three:3, four:4, five:5, six:6,
                       seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 };
  // "attacks twice", "uses X three times" — adverbial / times counts.
  const ADVERB_NUM = { once:1, twice:2, thrice:3 };

  function numFromWord(w) {
    if (!w) return 1;
    const k = w.toLowerCase();
    return ADVERB_NUM[k] || WORD_NUM[k] || 1;
  }

  // Count token → number: bare digits ("3") or number words ("three").
  function countOf(w) {
    if (!w) return 1;
    if (/^\d+$/.test(w)) return parseInt(w, 10);
    return WORD_NUM[w.toLowerCase()] || 1;
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
    const colon = body.match(/makes\s+(?:a|an|one|two|three|four|five|six|\d+)\s+attacks?\s*:\s*([^.]+)/i);
    if (colon) {
      const payload = colon[1];
      // A1) or-separated options with per-option counts: "two pick attacks or
      // two slam attacks, or one of each" → weighted choose (dynamic at sim time).
      if (/\bor\b/i.test(payload)) {
        const opts = [];
        const reOpt = /(a|an|one|two|three|four|five|six|\d+)\s+([\w'’ -]+?)\s+attacks?\b/gi;
        let om;
        while ((om = reOpt.exec(payload)) !== null) {
          const nm = cleanOpt(om[2]);
          if (nm && !GENERIC_ATTACK.test(nm) && !/\battacks?\b/i.test(nm)) opts.push({ name: nm, count: countOf(om[1]) });
        }
        if (opts.length >= 2) return [{ _chooseFromWeighted: opts }];
        if (opts.length === 1) return [{ actionName: opts[0].name, count: opts[0].count }];
      }
      const plan = [];
      for (const chunk of payload.split(/\s*(?:,|\band\b)\s*/i)) {
        const m = chunk.match(/(?:(a|an|one|two|three|four|five|six|\d+)\s+)?(?:with\s+(?:its|his|her|their)\s+)?([\w'’ -]+)/i);
        if (m && m[2] && m[2].trim()) plan.push({ actionName: m[2].trim(), count: m[1] ? countOf(m[1]) : 1 });
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
    // B3) "makes (up to) N attacks using A, B, C(, or D / or both)" → choose-best-of.
    // ("in any combination" phrasing is claimed by B above; this is the looser form.)
    const usingList = body.match(/makes\s+(?:up\s+to\s+)?(a|an|one|two|three|four|five|six|\d+)\s+attacks?\s+using\s+([^.;]+)/i);
    if (usingList) {
      const opts = usingList[2].split(/\s*(?:,|\bor\b|\band\b)\s*/i).map(cleanOpt).filter(Boolean)
        .filter(o => !GENERIC_ATTACK.test(o)
                  && !/^(?:both|them|these|each|any\s+combination)$/i.test(o)
                  && !/\battacks?\b/i.test(o));
      if (opts.length >= 2) return [{ _chooseFrom: opts, count: countOf(usingList[1]) }];
      if (opts.length === 1) return [{ actionName: opts[0], count: countOf(usingList[1]) }];
    }
    // B4) "makes N attacks with its X (and M Y attack(s))*" — unnamed count
    // attached to a possessive weapon name, plus optional trailing clauses.
    const withIts = body.match(/makes\s+(a|an|one|two|three|four|five|six|\d+)\s+attacks?\s+with\s+(?:its|his|her|their)\s+([\w'’ -]+?)(?=\s+and\b|[.,;:]|$)/i);
    if (withIts) {
      // "with its longsword or shortbow" → dynamic options, not one name.
      const first = /\s+or\s+/i.test(withIts[2])
        ? { _chooseFrom: withIts[2].split(/\s+or\s+/i).map(cleanOpt).filter(Boolean), count: countOf(withIts[1]) }
        : { actionName: cleanOpt(withIts[2]), count: countOf(withIts[1]) };
      const plan = [first];
      const rest = body.slice(withIts.index + withIts[0].length);
      const reAnd = /\band\s+(a|an|one|two|three|four|five|six|\d+)\s+([\w'’ -]+?)\s+attacks?\b/gi;
      let am;
      while ((am = reAnd.exec(rest)) !== null) {
        const nm = cleanOpt(am[2]);
        if (nm && !GENERIC_ATTACK.test(nm) && !/\battacks?\b/i.test(nm)) plan.push({ actionName: nm, count: countOf(am[1]) });
      }
      return plan;
    }
    // B5) dice-count: "makes 1d4 + 1 slam attacks" → average count, rounded.
    const diceCount = body.match(/makes\s+(\d+)d(\d+)(?:\s*\+\s*(\d+))?\s+([\w'’ -]+?)\s+attacks?\b/i);
    if (diceCount) {
      const avg = Math.round(parseInt(diceCount[1], 10) * (parseInt(diceCount[2], 10) + 1) / 2
                             + (diceCount[3] ? parseInt(diceCount[3], 10) : 0));
      const nm = cleanOpt(diceCount[4]);
      if (nm && !GENERIC_ATTACK.test(nm) && !/\battacks?\b/i.test(nm)) return [{ actionName: nm, count: Math.max(1, avg) }];
    }
    // B6) "as many X attacks as it has <parts>" / "a number of X attacks equal
    // to the number of <parts>" — count resolved from the monster's traits in
    // the post-pass (e.g. Hydra: "has five heads"); defaults there if absent.
    const asMany = body.match(/makes?\s+as\s+many\s+([\w'’ -]+?)\s+attacks?\s+as\s+(?:it|he|she|they)\s+(?:has|have|currently\s+has|currently\s+have)\s+([\w-]+)/i)
      || body.match(/(?:can\s+)?makes?\s+a\s+number\s+of\s+([\w'’ -]+?)\s+attacks?\s+equal\s+to\s+the\s+number\s+of\s+([\w-]+)/i);
    if (asMany) return [{ actionName: cleanOpt(asMany[1]), count: null, _countRef: asMany[2].toLowerCase() }];
    // C) "makes N X attacks (and M Y attacks)*" (explicit named)
    {
      const re = /(?:makes\s+|and\s+)(a|an|one|two|three|four|five|six|\d+)\s+([\w'’ -]+?)\s+attacks?\b/gi;
      const plan = [];
      let m;
      while ((m = re.exec(body)) !== null) {
        const nm = m[2].trim();
        // skip bare/generic tokens — those are handled by the unnamed fallback —
        // and names that swallowed an "attacks…" clause (lazy-match overrun).
        if (nm && !/^(?:more|other|additional|melee|ranged|weapon|spell)$/i.test(nm)
               && !/\battacks?\b/i.test(nm)) {
          plan.push({ actionName: nm, count: countOf(m[1]) });
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
    // v3.8: thrown weapon detection. A 'both' (Melee or Ranged) weapon with a
    // range profile is thrown (handaxe, javelin, spear, dagger, trident), as is
    // any body carrying the explicit "thrown" keyword. Pure ranged weapons
    // (bows/crossbows) are NOT thrown. Attached only when true so non-thrown
    // attacks stay byte-identical.
    if ((actionRange === 'both' && rangeM) || /\bthrown\b/i.test(body)) parsed.thrown = true;
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

  // ─────────── Pass 3.6a — Temporary hit points (as self-heal) ───────────
  // "gains 20 Temporary Hit Points" / "gains 10 (3d6) temporary hit points".
  // Modeled as a self-heal — temp HP ≈ effective HP for sim purposes (capped
  // at max HP, which slightly undervalues it; better than skipping).
  const TEMP_HP_RE = /\bgains?\s+(\d+)(?:\s*\((\d+d\d+)(?:\s*\+\s*(\d+))?\))?\s+temporary\s+hit\s+points/i;

  function tryTempHp(actionName, body) {
    const m = body.match(TEMP_HP_RE);
    if (!m) return null;
    return {
      sourceActionName: actionName,
      kind: 'heal',
      heal: { dice: m[2] || null, mod: m[3] ? parseInt(m[3], 10) : 0,
              flat: m[2] ? 0 : parseInt(m[1], 10),
              target: 'self', aoeTargets: 0, reviveDowned: false, temp: true },
      parsedBy: 'auto',
      parsedAt: today(),
    };
  }

  // ─────────── Pass 3.6b — Save-less automatic damage ───────────
  // "Each creature within 60 feet … takes 14 (4d6) Lightning damage." /
  // "Response: The triggering creature takes 3 (1d6) Psychic damage."
  // No attack roll, no save → modeled as a save action with autoHit:true
  // (the engine skips the roll and applies damageOnFail directly).
  const AUTODMG_TARGET_RE = /\b(?:each\s+creature|each\s+enemy|the\s+(?:triggering\s+)?(?:creature|target)|creatures?\s+(?:in|within)|all\s+creatures)\b/i;

  function tryAutoDamage(actionName, body) {
    if (ATTACK_HEADER_RE.test(body) || /DC\s+\d+/i.test(body)) return null;
    if (!AUTODMG_TARGET_RE.test(body)) return null;
    // Damage conditional on a future hit ("If that attack hits, … extra …
    // damage") is a rider on another action, not immediate damage.
    if (/\bif\s+(?:that|this|the|an?)\s+attack\s+hits\b/i.test(body)) return null;
    if (/\bextra\b[^.]{0,60}\bdamage\b/i.test(body)) return null;
    // Damage gated on an existing grapple/swallow state isn't at-will —
    // leave for DM review rather than modeling it as a free nuke.
    if (/\b(?:it\s+is\s+grappling|grappled\s+by|swallow(?:s|ed)?)\b/i.test(body)) return null;
    const dmg = extractDamage(body);
    if (!dmg.length) return null;
    const aoe = /\beach\s+creature\b|\ball\s+creatures\b|\bcreatures?\s+(?:in|within)\b/i.test(body);
    return {
      sourceActionName: actionName,
      kind: 'save',
      autoHit: true,
      saveAbility: null,
      saveDc: null,
      aoeTargets: aoe ? Math.max(2, aoeTargetsFromShape(body)) : 1,
      effectOnFail: 'damage',
      damageOnFail: dmg,
      damageOnSave: [],
      halfOnSave: false,
      condition: null,
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

  // ─────────── Pass 3.9 — Recognized non-simulatable text ───────────
  // Bodies with NO simulatable mechanics (no attack header / to-hit, no damage
  // or heal dice, no save/check DC, no HP change, no flat damage) are honest
  // `utility` classifications, not parse failures: passive traits misfiled
  // into action buckets by the scrape, triggered reactions, area control,
  // forced movement, narrative fragments. Anything carrying numbers that
  // matter falls through to `unparsed` so the DM reviews it.
  function tryClassify(actionName, body) {
    if (!body || !body.trim()) return null;                            // truly empty → unparsed
    if (ATTACK_HEADER_RE.test(body)) return null;
    if (/[+-]\d+\s+to\s+hit/i.test(body)) return null;
    if (/\(\d+d\d+/.test(body)) return null;                           // damage/heal dice
    if (/DC\s+\d+/i.test(body)) return null;                           // save/check DCs
    if (/\bhit\s+points?\b/i.test(body)) return null;                  // HP manipulation
    if (/\b(?:takes?|taking)\s+\d+\s+[\w\s]*damage/i.test(body)) return null;  // flat damage
    let note = 'no simulatable combat mechanics (classified non-combat)';
    if (/\bfails?\s+a\s+saving\s+throw,?\s+(?:it|he|she|they)\s+can\s+choose\s+to\s+succeed/i.test(body)) {
      note = 'legendary resistance (not simulated)';
    } else if (/\btrigger\s*:/i.test(body) || /\bresponse\s*:/i.test(body)) {
      note = 'triggered reaction (not simulated)';
    } else if (/\bhas\s+advantage\s+on\b[^.]*\b(?:checks?|saving\s+throws?)\b/i.test(body)) {
      note = 'passive trait (no action effect)';
    } else if (/\b(?:pulls?|pushes?|drags?)\b[^.]*\b(?:toward|away)/i.test(body)) {
      note = 'forced movement (not simulated)';
    } else if (/\bemanation\b|\baura\b|\bantimagic\b|-foot\s+(?:cone|sphere|cube|line|radius)\b/i.test(body)) {
      note = 'area control (not simulated)';
    } else if (/\bcondition\b/i.test(body)) {
      note = 'condition effect without save DC (not simulated)';
    }
    return {
      sourceActionName: actionName,
      kind: 'utility',
      _note: note,
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
    const p5a = tryTempHp(actionName, body);      if (p5a) return attachResourceGating(p5a, actionName);
    const p5b = tryAutoDamage(actionName, body);  if (p5b) return attachResourceGating(p5b, actionName);
    const p6 = tryUtility(actionName, body);      if (p6) return attachResourceGating(p6, actionName);
    const p7 = tryClassify(actionName, body);     if (p7) return attachResourceGating(p7, actionName);
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

  // Resolve a `_countRef` ("as many Bite attacks as it has heads") against the
  // monster's traits/description: find "<number> heads" and use it. Defaults to
  // 3 when no explicit count is stated anywhere.
  function countFromTraits(monster, ref) {
    const singular = String(ref || '').replace(/s$/, '');
    const texts = [];
    for (const t of (monster && monster.traits) || []) texts.push((t.name || '') + ' ' + (t.body || ''));
    if (monster && typeof monster.description === 'string') texts.push(monster.description);
    const re = new RegExp('(\\w+)\\s+(?:' + singular + 's?)\\b', 'gi');
    for (const txt of texts) {
      let m;
      while ((m = re.exec(txt)) !== null) {
        const w = m[1].toLowerCase();
        const n = /^\d+$/.test(w) ? parseInt(w, 10) : WORD_NUM[w];
        if (n >= 2 && n <= 12) return n;
      }
    }
    return 3;
  }

  // ─────────── Multiattack plan resolution (post-parse) ───────────
  // Runs once all of a monster's actions are parsed, so sibling action names +
  // their damage are available. For each auto-parsed multiattack:
  //   • `_chooseFrom:[…]` → validate options; keep them on the step as
  //     `options` for dynamic per-swing choice at sim time (melee vs ranged),
  //     with `actionName` set to the highest-damage option as the fallback.
  //   • `_chooseFromWeighted` → same, kept as `optionsWeighted` (per-option counts).
  //   • `actionName:null`  → the monster's best (highest-damage) attack.
  //   • `_countRef`        → count pulled from traits (e.g. Hydra heads).
  //   • explicit names     → fuzzy-validated against real sibling names.
  // Invalid entries are dropped. Duplicate plain names are merged (counts
  // summed). If nothing valid remains, the multiattack degrades to `unparsed`
  // rather than emitting a plan that references non-existent actions.
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
          // Validate options; sort by count × per-attack average damage.
          // ≥2 valid → keep them all for dynamic sim-time choice; the best is
          // the fallback actionName (also what non-spatial consumers see).
          let valid = step._chooseFromWeighted
            .map(o => ({ actionName: fuzzyMatchName(o.name, names), count: o.count }))
            .filter(o => o.actionName);
          valid = valid.filter((o, i) => valid.findIndex(x => x.actionName === o.actionName) === i);
          if (valid.length >= 2) {
            valid.sort((a, b) => (b.count * avgOf(b.actionName)) - (a.count * avgOf(a.actionName)));
            resolved.push({ actionName: valid[0].actionName, count: valid[0].count, optionsWeighted: valid });
          } else if (valid.length === 1) {
            resolved.push({ actionName: valid[0].actionName, count: valid[0].count });
          }
        } else if (step._chooseFrom) {
          let cands = step._chooseFrom.map(o => fuzzyMatchName(o, names)).filter(Boolean);
          cands = cands.filter((v, i) => cands.indexOf(v) === i);
          if (cands.length) {
            cands.sort((a, b) => avgOf(b) - avgOf(a));
            if (cands.length >= 2) resolved.push({ actionName: cands[0], count: step.count, options: cands });
            else resolved.push({ actionName: cands[0], count: step.count });
          }
        } else if (step._countRef) {
          const match = fuzzyMatchName(step.actionName, names);
          if (match) resolved.push({ actionName: match, count: countFromTraits(monster, step._countRef) });
        } else if (step.actionName == null) {
          if (bestAttack) resolved.push({ actionName: bestAttack.sourceActionName, count: step.count });
        } else {
          const match = fuzzyMatchName(step.actionName, names);
          if (match) resolved.push({ actionName: match, count: step.count });
        }
      }
      // Merge duplicate PLAIN names (sum counts), preserving first-seen order.
      // Steps carrying options stay distinct — their choice is per-swing.
      const merged = [];
      for (const s of resolved) {
        const ex = !s.options && !s.optionsWeighted
          && merged.find(x => x.actionName === s.actionName && !x.options && !x.optionsWeighted);
        if (ex) ex.count += s.count; else merged.push(s);
      }
      if (merged.length) {
        pa.multiattackPlan = merged;
        delete pa._raw;
      } else if (bestAttack) {
        // Every referenced name was unknown (scrape glued the sub-actions into
        // the Multiattack body, or names drifted) but the monster DOES have a
        // parsed attack — approximate with its best attack × the stated swing
        // count instead of dropping the whole action. Flagged for Review.
        let totalCount = 0;
        for (const step of pa.multiattackPlan) totalCount += step.count || 1;
        pa.multiattackPlan = [{ actionName: bestAttack.sourceActionName,
                                count: Math.max(1, totalCount) }];
        pa._note = 'plan referenced unknown actions — fell back to best attack';
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
