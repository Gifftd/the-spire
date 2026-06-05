/* ─────────────────────────────────────────────────────────────────────
 * scrape_fm_ddb.js  —  Flee Mortals (MCDM) DDB scrape helper
 *
 * Verified working against the actual DDB DOM (June 2026). The FM
 * book uses `.mcdm-statblock` as the per-monster wrapper, with field
 * labels in `<strong>` tags and section headers in `<p
 * class="monster--action-header">`. Different layout from the MM 2024
 * scrape — this script is FM-specific.
 *
 * Usage:
 *   1. Visit each of the 5 stat-block pages on D&D Beyond:
 *        https://www.dndbeyond.com/sources/fm/creatures-ad
 *        https://www.dndbeyond.com/sources/fm/creatures-ek
 *        https://www.dndbeyond.com/sources/fm/creatures-ls
 *        https://www.dndbeyond.com/sources/fm/creatures-tz
 *        https://www.dndbeyond.com/sources/fm/villain-parties
 *   2. On EACH page, paste the contents of this file into the devtools
 *      console and hit enter. Each invocation scrapes the current page
 *      and APPENDS to `localStorage.fm_scrape`.
 *   3. After visiting all 5 pages, run the second snippet at the
 *      bottom (`window.__fmDownload()`) — it builds the envelope and
 *      triggers a Blob download of `fm.json` to ~/Downloads.
 *   4. Move `fm.json` to the project root.
 *   5. `python3 scripts/normalize_bestiary.py` — auto-picks it up,
 *      concatenates into bestiary.json alongside mm + tob.
 *   6. Menagerie Import tab → import the regenerated bestiary.json
 *      (Merge mode). The library auto-rebuild ingests FM features in
 *      the same operation.
 *
 * Output yields ~305 monsters across the FM stat-block pages:
 *   - 221 standard monsters (CR + role)
 *   - 35 villain-party NPCs
 *   - 26 player-companions (PB-scaled — fmCategory:companion)
 *   - 23 retainers (PB-scaled — fmCategory:retainer)
 *
 * FM-specific fields captured:
 *   - fmRole: one of the 9 Flee Mortals roles (Ambusher / Artillery /
 *     Brute / Controller / Defender / Leader / Skirmisher / Soldier /
 *     Support) — sourced directly from the "CR X Role" line.
 *   - villainActions: 1/round boss powers parsed under "Villain
 *     Actions" headers.
 *   - isMinion / isSolo: detected from the CR-line suffix.
 *   - fmCategory: 'companion' / 'retainer' / 'villain-party' /
 *     'minion' / 'solo' / '' (standard).
 *
 * The normalize_bestiary.py side promotes fmRole → role and stamps
 * roleManual:true so the auto-tagger never overrides MCDM's intent.
 * ─────────────────────────────────────────────────────────────────── */

(function(){
  const ABIL = ['str','dex','con','int','wis','cha'];
  const MOD = s => Math.floor((+s - 10) / 2);
  const FM_ROLES = ['Ambusher','Artillery','Brute','Controller','Defender','Leader','Skirmisher','Soldier','Support'];
  const pascalId = n => n.replace(/[^a-zA-Z0-9]+/g, '').replace(/^(.)/, c => c.toUpperCase()) + 'StatBlock';
  const crToNum = s => {
    if (!s) return 0;
    if (s === '1/8') return 0.125;
    if (s === '1/4') return 0.25;
    if (s === '1/2') return 0.5;
    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
  };

  // 2014-style action prose → 2024 phrasing the rest of the pipeline expects.
  function modernize(body){
    let x = body || '';
    x = x.replace(/,\s*one target\.\s*/g, ' ');
    x = x.replace(/Melee or Ranged Weapon Attack:\s*([+\-]\d+(?:\s*plus PB)?)\s+to hit,\s*/g, 'Melee or Ranged Attack Roll: $1, ');
    x = x.replace(/Melee Weapon Attack:\s*([+\-]\d+(?:\s*plus PB)?)\s+to hit,\s*/g, 'Melee Attack Roll: $1, ');
    x = x.replace(/Ranged Weapon Attack:\s*([+\-]\d+(?:\s*plus PB)?)\s+to hit,\s*/g, 'Ranged Attack Roll: $1, ');
    x = x.replace(/Melee Spell Attack:\s*([+\-]\d+)\s+to hit,\s*/g, 'Melee Attack Roll: $1, ');
    x = x.replace(/Ranged Spell Attack:\s*([+\-]\d+)\s+to hit,\s*/g, 'Ranged Attack Roll: $1, ');
    x = x.replace(/\b([a-z]+)\s+damage\b/g, (m, t) => t.charAt(0).toUpperCase() + t.slice(1) + ' damage');
    x = x.replace(/\s*\.\s*\.\s*/g, '. ').replace(/\s+/g, ' ').trim();
    return x;
  }

  // Strip recharge / per-day marker out of an action name → returns
  // both the bare name and the trailing tag (kept in the canonical
  // name as " (Recharge X)" so the chimera renderer carries it).
  function nameAndRecharge(raw){
    const m = raw.match(/^(.*?)(\s*\((?:Recharge[s]?[^)]+|\d+\s*\/\s*Day)\))\s*$/i);
    if (m) return { name: m[1].trim(), tag: m[2].trim() };
    return { name: raw.trim(), tag: '' };
  }

  function parseStatBlock(root){
    const out = {
      id: '', name: '', source: 'fm-v1',
      sourcePage: location.pathname.split('/').pop(),
      size: '', type: '', subtype: '', alignment: '',
      ac: 0, acText: '', hp: 0, hpFormula: '',
      speed: {}, speedText: '',
      initiative: 0, initiativeScore: 10,
      abilities: Object.fromEntries(ABIL.map(k => [k, { score: 10, mod: 0, save: 0 }])),
      skills: {}, sensesText: '',
      languagesText: '', languages: [],
      resistancesText: '', immunitiesText: '', vulnerabilitiesText: '',
      cr: 0, crText: '', xp: 0, pb: 2,
      traits: [], actions: [], bonusActions: [], reactions: [], legendaryActions: [],
      lairActions: [], lairEffects: [], villainActions: [],
      isMinion: false, isSolo: false, fmRole: '', fmCategory: '',
      description: ''
    };

    const nh = root.querySelector('.compendium-hr.heading-anchor, h3.compendium-hr, h4.compendium-hr');
    out.name = (nh?.textContent || '').trim();
    if (!out.name) return null;
    out.id = pascalId(out.name);

    // Name-suffix-based category hints
    if (/Companion$/i.test(out.name)) out.fmCategory = 'companion';
    else if (/Retainer$/i.test(out.name)) out.fmCategory = 'retainer';

    // mon-data: name, size+type, CR+role, XP
    const md = root.querySelector('.mon-data');
    if (md){
      const lines = md.textContent.split('\n').map(s => s.trim()).filter(Boolean);
      for (const ln of lines){
        const m1 = ln.match(/^(Tiny|Small|Medium|Large|Huge|Gargantuan)\s+(\w[\w\s]*?)(?:\s*\(([^)]+)\))?,\s*(.+)$/);
        if (m1){
          out.size = m1[1]; out.type = m1[2].trim();
          out.subtype = m1[3] || ''; out.alignment = m1[4].trim();
          continue;
        }
        // FM "CR X …" line variants observed on DDB:
        //   "CR 1/4 Skirmisher"       — standard
        //   "CR 1/4 Minion"           — minion (no role token at all)
        //   "CR 20 Solo"              — solo (no role token)
        //   "CR 20 Brute Solo"        — solo with a role (rare but possible)
        // The original regex assumed a role always came first, which
        // missed the no-role minion/solo cases. Tokenize the post-CR
        // suffix and check each word independently.
        const m2 = ln.match(/^CR\s+([\d/]+)\s+(.+)$/i);
        if (m2){
          out.crText = m2[1]; out.cr = crToNum(m2[1]);
          for (const tok of m2[2].trim().split(/\s+/)){
            if (tok === 'Minion'){ out.isMinion = true; out.fmCategory = out.fmCategory || 'minion'; }
            else if (tok === 'Solo'){ out.isSolo = true; out.fmCategory = out.fmCategory || 'solo'; }
            else if (FM_ROLES.includes(tok)){ out.fmRole = tok; }
          }
          continue;
        }
        const m3 = ln.match(/^([\d,]+)\s*XP$/i);
        if (m3) out.xp = parseInt(m3[1].replace(/,/g, ''), 10);
      }
    }

    // Walk standalone <p> children for AC/HP/Speed/Skills/etc.
    const ps = Array.from(root.querySelectorAll(':scope > p'));
    for (const p of ps){
      const t = p.textContent.replace(/\s+/g, ' ').trim();
      let m;
      if (m = t.match(/^Armor Class\s+(.+)/i)){ out.acText = m[1]; out.ac = parseInt(m[1], 10) || 0; continue; }
      if (m = t.match(/^Hit Points\s+(\d+)(?:\s*\(([^)]+)\))?/i)){ out.hp = parseInt(m[1], 10); out.hpFormula = m[2] || ''; continue; }
      if (m = t.match(/^Speed\s+(.+)/i)){
        out.speedText = m[1];
        for (const tok of m[1].split(',')){
          const tm = tok.trim().match(/^(?:(\w+)\s+)?(\d+)\s*ft/i);
          if (tm) out.speed[(tm[1] || 'walk').toLowerCase()] = parseInt(tm[2], 10);
        }
        continue;
      }
      if (m = t.match(/^Saving Throws?\s+(.+)/i)){
        for (const tok of m[1].split(',')){
          const sm = tok.trim().match(/^(\w+)\s+([+\-]?\d+)$/);
          if (sm){
            const k = sm[1].toLowerCase().slice(0, 3);
            if (out.abilities[k]) out.abilities[k].save = parseInt(sm[2], 10);
          }
        }
        continue;
      }
      if (m = t.match(/^Skills\s+(.+)/i)){
        for (const tok of m[1].split(',')){
          const sm = tok.trim().match(/^(.+?)\s+([+\-]?\d+)$/);
          if (sm) out.skills[sm[1].trim()] = parseInt(sm[2], 10);
        }
        continue;
      }
      if (m = t.match(/^(?:Damage )?Resistances\s+(.+)/i)){ out.resistancesText = m[1]; continue; }
      if (m = t.match(/^(?:Damage )?Vulnerabilities\s+(.+)/i)){ out.vulnerabilitiesText = m[1]; continue; }
      if (m = t.match(/^Damage Immunities\s+(.+)/i)){ out.immunitiesText = m[1]; continue; }
      if (m = t.match(/^Condition Immunities\s+(.+)/i)){ out.immunitiesText = (out.immunitiesText ? out.immunitiesText + '; ' : '') + m[1]; continue; }
      if (m = t.match(/^Senses\s+(.+)/i)){ out.sensesText = m[1]; continue; }
      if (m = t.match(/^Languages\s+(.+)/i)){ out.languagesText = m[1]; out.languages = m[1].split(',').map(s => s.trim()).filter(Boolean); continue; }
      if (m = t.match(/^Proficiency Bonus\s+\+?(\d+)/i)){ out.pb = parseInt(m[1], 10); continue; }
    }

    // Abilities from .monster--stats grid
    const sd = root.querySelector('.monster--stats');
    if (sd){
      const ps2 = Array.from(sd.querySelectorAll('p'));
      const scores = ps2.filter(p => /^\d+\s*\(/.test(p.textContent.trim()))
                        .map(p => parseInt(p.textContent, 10));
      if (scores.length >= 6){
        for (let i = 0; i < 6; i++){
          const s = scores[i];
          const prevSave = out.abilities[ABIL[i]].save;
          out.abilities[ABIL[i]] = { score: s, mod: MOD(s), save: prevSave !== 0 ? prevSave : MOD(s) };
        }
      }
    }
    out.initiative = out.abilities.dex.mod;
    out.initiativeScore = 10 + out.abilities.dex.mod;

    // Sections: switch on <p class="monster--action-header"> markers.
    // Everything before Proficiency Bonus is metadata; everything after
    // (until the first action-header) is traits.
    let cs = null;
    let seenPB = false;
    const sm = {
      'actions': 'actions', 'bonus actions': 'bonusActions',
      'reactions': 'reactions', 'legendary actions': 'legendaryActions',
      'villain actions': 'villainActions', 'lair actions': 'lairActions',
      'lair effects': 'lairEffects'
    };
    for (const p of ps){
      const t = p.textContent.replace(/\s+/g, ' ').trim();
      if (/^Proficiency Bonus/i.test(t)){ seenPB = true; continue; }
      if (!seenPB) continue;
      if (p.classList.contains('monster--action-header')){
        cs = sm[t.toLowerCase()] || null;
        continue;
      }
      const str = p.querySelector('strong, em, b');
      if (str){
        const nr = nameAndRecharge(str.textContent.replace(/[.:]\s*$/, ''));
        const fullName = nr.tag ? nr.name + ' ' + nr.tag : nr.name;
        let body = t;
        body = body.replace(
          new RegExp('^' + str.textContent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[.:]\s*$/, '') + '\\s*[.:]?\\s*'),
          ''
        ).trim();
        body = modernize(body);
        const item = { name: fullName, body };
        if (cs) out[cs].push(item);
        else out.traits.push(item);
      } else if (t.length > 4){
        const sec = cs || 'traits';
        const list = out[sec];
        if (list.length) list[list.length - 1].body = modernize(list[list.length - 1].body + ' ' + t);
      }
    }
    return out;
  }

  // ── Run on current page → append to localStorage.fm_scrape ────────
  const blocks = Array.from(document.querySelectorAll('.mcdm-statblock'));
  const monsters = [];
  for (const b of blocks){
    try {
      const m = parseStatBlock(b);
      if (m){
        // Villain-parties page: blanket-tag as 'villain-party' unless
        // an earlier rule already set fmCategory (companion/retainer).
        if (location.pathname.endsWith('/villain-parties') && !m.fmCategory){
          m.fmCategory = 'villain-party';
        }
        monsters.push(m);
      }
    } catch(e){
      console.warn('failed to parse a block:', e);
    }
  }
  const existing = JSON.parse(localStorage.getItem('fm_scrape') || '[]');
  const all = existing.concat(monsters);
  localStorage.setItem('fm_scrape', JSON.stringify(all));
  console.log(`[${location.pathname.split('/').pop()}] scraped ${monsters.length} monsters, total so far: ${all.length}`);

  // Expose download helper for the final page — call as
  // `window.__fmDownload()` from the console.
  window.__fmDownload = function(){
    const monsters = JSON.parse(localStorage.getItem('fm_scrape') || '[]');
    // Post-process: anything with no CR and no fmRole and no
    // fmCategory is a retainer (FM retainer stat blocks omit the
    // CR-Role line entirely, listing "Retainer" as its own line).
    let retainerCount = 0;
    for (const m of monsters){
      if (!m.fmCategory && !m.crText && !m.fmRole){
        m.fmCategory = 'retainer';
        retainerCount++;
      }
    }
    const envelope = {
      source: 'fm-v1',
      scrapedAt: new Date().toISOString(),
      count: monsters.length,
      monsters
    };
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'fm.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 200);
    console.log(`Downloaded fm.json — ${monsters.length} monsters (${retainerCount} retag'd as retainer). Move to project root + run scripts/normalize_bestiary.py.`);
  };
})();

/* ── After visiting all 5 pages, run this snippet to download fm.json ──
 *
 *   window.__fmDownload();
 *
 * Or as a one-liner for the console:
 *
 *   localStorage.removeItem('fm_scrape')    // to reset between runs
 * ────────────────────────────────────────────────────────────────── */
