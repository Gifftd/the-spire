/* ─────────────────────────────────────────────────────────────────────
 * scrape_fm_ddb.js  —  Flee Mortals (MCDM) DDB scrape helper
 *
 * Paste this whole file into a Chrome devtools console while sitting
 * on the Flee Mortals source page on D&D Beyond — typically:
 *   https://www.dndbeyond.com/sources/dnd/flee-mortals/monsters
 * or whichever page renders the full monsters inline.
 *
 * Output: triggers a Blob download of `fm.json` to your Downloads
 * folder. Drop that file in the project root, then run:
 *   python3 scripts/normalize_bestiary.py
 * which now knows the FM shape — it preserves villainActions /
 * isMinion / isSolo / fmRole and flips roleManual:true on every FM
 * monster so the auto-tagger never overrides MCDM's intent.
 *
 * Then in the Menagerie's Import tab → select the merged
 * bestiary.json → Merge → done. The auto-rebuild reshapes the
 * feature library against the new monsters in the same operation.
 *
 * ─────────────────────────────────────────────────────────────────────
 * IMPORTANT: DDB's exact CSS selectors differ across books. The
 * selectors below are the patterns the MM 2024 scrape used and FM
 * should be similar, but verify against the page if extraction looks
 * wrong. Search comments tagged `// VERIFY` for spots to double-check.
 * ─────────────────────────────────────────────────────────────────── */

(() => {
  // VERIFY — the wrapper that contains all monster stat blocks on the
  // FM source page. On the MM 2024 sources it's `.stat-block-background`,
  // but FM may use a different class. Inspect a monster header in
  // devtools to confirm.
  const STAT_BLOCK_SEL = '.stat-block-background, .Basic-Text-Frame .stat-block, [data-content-chunk-id*="stat-block"]';

  // Source slug — stamped on every monster's `source` field. The
  // normalizer keys book-source counts off this.
  const SOURCE_TAG = 'fm-v1';
  const SOURCE_PAGE_HINT = (location.pathname.split('/').pop() || 'monsters');

  // ── Helpers ────────────────────────────────────────────────────────
  const $$ = (root, sel) => Array.from((root || document).querySelectorAll(sel));
  const txt = (el) => (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  const pascalId = (name) => name.replace(/[^a-zA-Z0-9]+/g, '').replace(/^(.)/, c => c.toUpperCase()) + 'StatBlock';
  const ABIL_KEYS = ['str','dex','con','int','wis','cha'];
  const MOD = (score) => Math.floor((Number(score) - 10) / 2);

  // FM role taxonomy (matches our internal one exactly). When the FM
  // header line has one of these tokens, capture it as `fmRole`.
  const FM_ROLES = new Set([
    'Ambusher','Artillery','Brute','Controller','Defender',
    'Leader','Skirmisher','Soldier','Support'
  ]);

  // ── Per-block extractor ────────────────────────────────────────────
  function parseStatBlock(root){
    // VERIFY: header structure. FM headers typically read:
    //   "Goblin Cutter | Skirmisher 1/2 (100 XP) | Small Humanoid, Neutral Evil"
    // or split across two header lines. Adjust selectors if your page
    // uses different elements (e.g. .mon-stat-block__name vs .Stat-Block-Styles_Stat-Block-Title).
    const nameEl = root.querySelector('.mon-stat-block__name, .Stat-Block-Styles_Stat-Block-Title, h2, h3, .stat-block__heading');
    const name = txt(nameEl) || 'Unknown';
    if (!name || name.length < 2) return null;

    // Role + size/type line — FM usually has a chip or sub-heading
    // with the role token and a size/type/alignment summary.
    const metaCandidates = $$(root, '.mon-stat-block__meta, .Stat-Block-Styles_Stat-Block-Title-Information, .stat-block__meta, .Basic-Text-Frame p').map(txt).filter(Boolean);
    const metaLine = metaCandidates.join(' · ');

    // Try to identify the FM role token in the meta line.
    let fmRole = '';
    for (const role of FM_ROLES){
      const rx = new RegExp(`\\b${role}\\b`, 'i');
      if (rx.test(metaLine)){
        fmRole = role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
        // restore canonical capitalization
        fmRole = Array.from(FM_ROLES).find(r => r.toLowerCase() === fmRole.toLowerCase()) || fmRole;
        break;
      }
    }

    // Minion / Solo — FM marks these explicitly. Look for the word in
    // the meta line, plus check for headers above the stat block.
    const headerBlob = (txt(root.closest('section, article, .ddb-statblock-item, .Basic-Text-Frame') || root) || '').toLowerCase();
    const isMinion = /\bminion\b/.test(headerBlob);
    const isSolo   = /\bsolo\b/.test(headerBlob);

    // Size / Type / Alignment — FM mostly uses standard 5e phrasing
    const sizeTypeMatch = metaLine.match(/(Tiny|Small|Medium|Large|Huge|Gargantuan)\s+([\w\s]+?)(?:,\s*([\w\s]+))?$/i);
    const size = sizeTypeMatch?.[1] || '';
    const type = (sizeTypeMatch?.[2] || '').trim();
    const alignment = (sizeTypeMatch?.[3] || '').trim();

    // CR — FM uses 5e CRs but also has its own role-level system. We
    // capture the standard CR fraction or integer from the meta.
    const crMatch = metaLine.match(/CR\s*([\d/]+)|Challenge\s*([\d/]+)/i) || metaLine.match(/\b(1\/8|1\/4|1\/2|\d+)\s*\(/);
    const crText = (crMatch?.[1] || crMatch?.[2] || '').trim();
    const cr = crText.includes('/') ? eval(crText.replace('/', '/')) : (parseInt(crText, 10) || 0);

    // XP — extract from "(N XP)" pattern
    const xpMatch = metaLine.match(/\(([\d,]+)\s*XP\)/i);
    const xp = xpMatch ? parseInt(xpMatch[1].replace(/,/g, ''), 10) : 0;

    // AC / HP / Speed — labels in the stat block; selectors here match
    // the MM 2024 pattern. VERIFY against an FM monster on DDB.
    function findLabel(label){
      // Looks for "<b>Label</b> value" or `<dt>Label</dt><dd>value</dd>`
      const allEls = $$(root, 'p, li, div.mon-stat-block__attribute, dt, dd');
      for (const el of allEls){
        const t = txt(el);
        const rx = new RegExp(`^${label}\\s*[:.]?\\s*(.+)$`, 'i');
        const m = t.match(rx);
        if (m) return m[1].trim();
      }
      return '';
    }
    const acText = findLabel('AC') || findLabel('Armor Class');
    const ac = parseInt((acText.match(/\d+/) || [])[0], 10) || 0;
    const hpText = findLabel('HP') || findLabel('Hit Points');
    const hp = parseInt((hpText.match(/\d+/) || [])[0], 10) || 0;
    const hpFormulaMatch = hpText.match(/\(([^)]+)\)/);
    const hpFormula = hpFormulaMatch ? hpFormulaMatch[1] : '';
    const speedText = findLabel('Speed') || '';
    const speed = {};
    const speedTokens = speedText.split(',').map(s => s.trim());
    for (const tok of speedTokens){
      const m = tok.match(/^(?:(\w+)\s+)?(\d+)\s*ft/i);
      if (m){
        const kind = (m[1] || 'walk').toLowerCase();
        speed[kind] = parseInt(m[2], 10);
      }
    }

    // Abilities — FM uses standard 5e attribute block (6 scores)
    const abilities = {};
    const abilCells = $$(root, '.mon-stat-block__stat, .ability-block__stat, .Stat-Block-Styles_Stat-Block-Statblock-Attributes p');
    if (abilCells.length >= 6){
      for (let i = 0; i < 6; i++){
        const cellTxt = txt(abilCells[i]);
        const scoreMatch = cellTxt.match(/(\d+)/);
        const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 10;
        abilities[ABIL_KEYS[i]] = { score, mod: MOD(score), save: MOD(score) };
      }
    } else {
      for (const k of ABIL_KEYS) abilities[k] = { score: 10, mod: 0, save: 0 };
    }

    // Skills / Senses / Languages — pull as raw strings; normalizer
    // handles parsing further.
    const skills = {};
    const skillsLine = findLabel('Skills');
    if (skillsLine){
      for (const tok of skillsLine.split(',').map(s => s.trim())){
        const m = tok.match(/^(.+?)\s+([+\-]?\d+)$/);
        if (m) skills[m[1].trim()] = parseInt(m[2], 10);
      }
    }
    const sensesText = findLabel('Senses') || '';
    const languagesText = findLabel('Languages') || '';
    const languages = languagesText.split(',').map(s => s.trim()).filter(Boolean);

    // Damage / condition immunities + resistances + vulnerabilities —
    // raw text; normalizer parses.
    const resistancesText = findLabel('Resistances') || findLabel('Damage Resistances') || '';
    const immunitiesText  = [findLabel('Immunities') || findLabel('Damage Immunities'), findLabel('Condition Immunities')].filter(Boolean).join('; ');
    const vulnerabilitiesText = findLabel('Vulnerabilities') || findLabel('Damage Vulnerabilities') || '';

    // ── Section extractors ───────────────────────────────────────────
    // VERIFY: FM uses standard H3/H4 headers ("Traits", "Actions",
    // "Bonus Actions", "Reactions", "Legendary Actions", "Villain
    // Actions") followed by feature paragraphs. The MM 2024 pattern
    // used `.mon-stat-block__section`-type wrappers; FM may differ.
    function extractSection(sectionLabel){
      const items = [];
      // Find a header matching sectionLabel, then walk siblings until
      // we hit another known header.
      const HEADER_TAGS = ['H2','H3','H4','H5'];
      const KNOWN_HEADERS = ['Traits','Actions','Bonus Actions','Reactions','Legendary Actions','Villain Actions','Lair Actions','Spellcasting','Description'];
      const headers = $$(root, 'h2, h3, h4, h5');
      const target = headers.find(h => txt(h).match(new RegExp(`^${sectionLabel}$`, 'i')));
      if (!target) return items;
      let n = target.nextElementSibling;
      while (n){
        const t = txt(n);
        if (HEADER_TAGS.includes(n.tagName) && KNOWN_HEADERS.some(h => new RegExp(`^${h}$`, 'i').test(t))){
          break;
        }
        // A feature item: leading bold name then prose. Patterns:
        //   "<p><strong>Name.</strong> Body</p>"
        //   "<p><em>Name.</em> Body</p>"
        const strong = n.querySelector('strong, em, b');
        if (strong){
          const nm = txt(strong).replace(/[.\:]\s*$/, '');
          const body = t.replace(txt(strong), '').replace(/^[.\:]\s*/, '').trim();
          if (nm) items.push({ name: nm, body });
        } else if (t.length > 4){
          // No bold name — treat as continuation of previous feature
          // (if any) or as a standalone unnamed paragraph.
          if (items.length){
            items[items.length - 1].body = (items[items.length - 1].body + ' ' + t).trim();
          } else {
            items.push({ name: '', body: t });
          }
        }
        n = n.nextElementSibling;
      }
      return items;
    }

    const traits = extractSection('Traits');
    const actions = extractSection('Actions');
    const bonusActions = extractSection('Bonus Actions');
    const reactions = extractSection('Reactions');
    const legendaryActions = extractSection('Legendary Actions');
    const villainActions = extractSection('Villain Actions');
    const lairActions = extractSection('Lair Actions');

    return {
      id: pascalId(name),
      name,
      source: SOURCE_TAG,
      sourcePage: SOURCE_PAGE_HINT,
      size, type, subtype: '', alignment,
      ac, acText, hp, hpFormula, speed, speedText,
      initiative: abilities.dex.mod,
      initiativeScore: 10 + abilities.dex.mod,
      abilities,
      skills,
      sensesText,
      languagesText, languages,
      resistancesText,
      immunitiesText,
      vulnerabilitiesText,
      cr, crText: crText || String(cr),
      xp,
      pb: (cr >= 0 ? Math.max(2, Math.floor((cr - 1) / 4) + 2) : 2),
      traits, actions, bonusActions, reactions, legendaryActions,
      lairActions, lairEffects: [],
      // ── FM-specific extensions ────────────────────────────────────
      villainActions,
      isMinion,
      isSolo,
      fmRole,
      fmCategory: isMinion ? 'minion' : (isSolo ? 'solo' : ''),
      description: ''
    };
  }

  // ── Walk every stat block on the page ──────────────────────────────
  const blocks = $$(document, STAT_BLOCK_SEL);
  console.log(`Found ${blocks.length} candidate stat blocks`);

  const monsters = [];
  for (const b of blocks){
    try {
      const m = parseStatBlock(b);
      if (m) monsters.push(m);
    } catch(e){
      console.warn('Failed to parse a block:', e);
    }
  }
  console.log(`Parsed ${monsters.length} monsters`);

  // Envelope mirrors the MM 2024 scrape shape so the existing
  // normalize_bestiary.py picks it up without changes.
  const payload = {
    source: SOURCE_TAG,
    scrapedAt: new Date().toISOString(),
    count: monsters.length,
    monsters
  };

  // Download as Blob — bypasses the Claude-in-Chrome 1024-char + URL-
  // filter limits (per the Obojima extraction notes).
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fm.json';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 50);
  console.log('Downloaded fm.json — drop it in the project root, then run scripts/normalize_bestiary.py');
})();
