#!/usr/bin/env python3
"""
Auto-tag bestiary monsters with Flee Mortals role and D&D terrain.

Reads bestiary.json from the project root, computes a `role` (one of nine
MCDM Flee Mortals categories) and `terrain` (list, from a fixed vocabulary)
for each monster, and writes the file back in place.

Idempotent: if a monster has `roleManual: true` the role isn't recomputed;
same for `terrainManual: true`. The Editor sets these when a DM edits the
chip, so re-running the tagger never clobbers human input.

Run after normalize_bestiary.py — this expects the canonical schema (v4+).
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BESTIARY = ROOT / 'bestiary.json'

# ─────────────────────────────────────────────────────────────────────
# Taxonomy
# ─────────────────────────────────────────────────────────────────────

ROLES = [
    'Ambusher', 'Artillery', 'Brute', 'Controller', 'Defender',
    'Leader', 'Skirmisher', 'Soldier', 'Support',
]

TERRAINS = [
    'arctic', 'coastal', 'desert', 'forest', 'grassland', 'hill',
    'mountain', 'swamp', 'underdark', 'underwater', 'urban', 'planar',
]

# ─────────────────────────────────────────────────────────────────────
# Terrain inference
# ─────────────────────────────────────────────────────────────────────

# Direct keyword → terrain hits in name + description prose.
TERRAIN_KEYWORDS = {
    'arctic':     [r'\bfrost\b', r'\bice\b', r'\bicy\b', r'\bpolar\b',
                   r'\bsnow\b', r'\bglaci', r'\btundra\b', r'\bwint(er|ry)\b',
                   r'\bblizzard\b'],
    'desert':     [r'\bsand\b', r'\bdesert\b', r'\barid\b', r'\bdune\b',
                   r'\bmummy\b', r'\bscorpion\b'],
    'coastal':    [r'\bcoast\b', r'\bshore\b', r'\bbeach\b', r'\btidal\b',
                   r'\bharbor\b', r'\breef\b'],
    'underwater': [r'\bsea\s', r'\bocean\b', r'\bdeep\s', r'\bcoral\b',
                   r'\baquatic\b', r'\bmarine\b', r'\bunderwat',
                   r'\bkraken\b', r'\bsahuagin\b', r'\bmerfolk\b',
                   r'\bkuo-toa\b', r'\bsiren\b', r'\btriton\b'],
    'swamp':      [r'\bswamp\b', r'\bmarsh\b', r'\bbog\b', r'\bfen\b',
                   r'\bmire\b'],
    'forest':     [r'\bforest\b', r'\bwood(s|land)?\b', r'\bjungle\b',
                   r'\bgrove\b', r'\bdryad\b'],
    'mountain':   [r'\bmountain\b', r'\bpeak\b', r'\balpine\b',
                   r'\bcliff\b', r'\bcrag\b'],
    'hill':       [r'\bhill\b', r'\bhighland\b'],
    'grassland':  [r'\bplain\b', r'\bsavann?ah?\b', r'\bsteppe\b',
                   r'\bmeadow\b', r'\bprairie\b'],
    'underdark':  [r'\bunderdark\b', r'\bcave\b', r'\bcavern\b',
                   r'\bdrow\b', r'\bduergar\b', r'\bderro\b',
                   r'\billithid\b', r'\bmind flay\b', r'\bsubterranean\b',
                   r'\bbeholder\b', r'\baboleth\b'],
    'urban':      [r'\bcity\b', r'\bcities\b', r'\bsewer\b', r'\btown\b',
                   r'\bvillage\b', r'\bsettle\b', r'\bstreets?\b',
                   r'\bdungeon\b', r'\bcrypt\b', r'\btomb\b'],
    'planar':     [r'\bcelestial\b', r'\bfiend\b', r'\bdemon\b',
                   r'\bdevil\b', r'\bangel\b', r'\belemental\s+plane',
                   r'\bnine hells\b', r'\babyss\b', r'\bfeywild\b',
                   r'\bshadowfell\b', r'\bouter plane', r'\binner plane',
                   r'\bmodron\b', r'\barchon\b', r'\bslaad\b'],
}

# Creature-type default fallbacks when no keywords land.
TYPE_TERRAIN = {
    'Beast':        ['forest', 'grassland'],
    'Plant':        ['forest', 'swamp'],
    'Fey':          ['forest'],
    'Aberration':   ['underdark'],
    'Construct':    ['urban'],
    'Undead':       ['urban'],
    'Ooze':         ['underdark'],
    'Celestial':    ['planar'],
    'Fiend':        ['planar'],
    'Elemental':    ['planar'],
    'Dragon':       ['mountain'],
    'Giant':        ['mountain'],
    'Humanoid':     ['urban'],
    'Monstrosity':  ['forest'],
}

# Dragon color → terrain (chromatic + metallic + gem, common assignments).
DRAGON_TERRAINS = {
    'red':       ['mountain'],
    'white':     ['arctic'],
    'black':     ['swamp'],
    'blue':      ['desert'],
    'green':     ['forest'],
    'brass':     ['desert'],
    'bronze':    ['coastal', 'underwater'],
    'copper':    ['hill'],
    'gold':      ['mountain'],
    'silver':    ['mountain', 'arctic'],
    'amethyst':  ['underdark'],
    'crystal':   ['mountain'],
    'emerald':   ['underdark'],
    'sapphire':  ['underdark'],
    'topaz':     ['desert'],
}

# Giant kind → terrain.
GIANT_TERRAINS = {
    'frost': ['arctic'],
    'fire':  ['mountain'],
    'cloud': ['mountain'],
    'storm': ['coastal', 'mountain'],
    'hill':  ['hill', 'grassland'],
    'stone': ['mountain'],
}

# Swarm tiny beasts are mostly urban/forest; not worth special-casing.


def infer_terrain(m):
    name = (m.get('name') or '').lower()
    desc = (m.get('description') or '').lower()
    ctype = m.get('type') or ''
    speed = m.get('speed') or {}
    haystack = name + ' ' + desc

    hits = set()
    for terr, patts in TERRAIN_KEYWORDS.items():
        for p in patts:
            if re.search(p, haystack):
                hits.add(terr)
                break

    # Speed signals — overlay regardless of keywords
    swim = speed.get('swim') or 0
    walk = speed.get('walk') or 0
    burrow = speed.get('burrow') or 0
    if swim >= 30 and swim >= walk:
        hits.add('underwater')
        if walk >= 20:
            hits.add('coastal')  # amphibious
    if burrow >= 20:
        hits.add('underdark')

    # Dragon special-cases — match against name
    if ctype == 'Dragon':
        for color, terrs in DRAGON_TERRAINS.items():
            if re.search(rf'\b{color}\b', name):
                hits.update(terrs)
                break

    # Giant species
    if ctype == 'Giant':
        for sp, terrs in GIANT_TERRAINS.items():
            if re.search(rf'\b{sp}\s+giant\b', name):
                hits.update(terrs)
                break

    # Outsiders default to planar even without explicit keyword
    if ctype in ('Celestial', 'Fiend', 'Elemental'):
        hits.add('planar')

    # Constructs are usually urban (golems, warforged, etc.) unless flagged elsewhere
    if ctype == 'Construct' and not hits:
        hits.add('urban')

    # Fallbacks
    if not hits:
        defaults = TYPE_TERRAIN.get(ctype, [])
        hits.update(defaults)

    if not hits:
        hits.add('grassland')

    return sorted(hits)


# ─────────────────────────────────────────────────────────────────────
# Role inference
# ─────────────────────────────────────────────────────────────────────

NUM_WORDS = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
}


def classify_action(action):
    """Mirror of bestiary-dm.html `classifyAction` — kind + key numbers."""
    name = (action.get('name') or '').strip()
    body = (action.get('body') or '').strip()
    out = {'kind': 'utility', 'attackBonus': None, 'saveDC': None}

    if re.match(r'^multiattack\b', name, re.IGNORECASE):
        out['kind'] = 'multiattack'
        return out

    if (re.match(r'^spellcasting$', name, re.IGNORECASE)
            or re.search(r'\bspellcasting ability\b', body, re.IGNORECASE)):
        out['kind'] = 'spellcasting'
        return out

    m_flex = re.search(r'Melee or Ranged Attack Roll:\s*([+\-]\d+)', body)
    m_melee = (not m_flex) and re.search(r'Melee Attack Roll:\s*([+\-]\d+)', body)
    m_ranged = (not m_flex and not m_melee) and re.search(
        r'Ranged Attack Roll:\s*([+\-]\d+)', body)
    atk = m_flex or m_melee or m_ranged
    if atk:
        if m_flex:
            out['kind'] = 'flex_attack'
        elif m_melee:
            out['kind'] = 'melee_attack'
        else:
            out['kind'] = 'ranged_attack'
        out['attackBonus'] = int(atk.group(1))
        return out

    sv = re.search(
        r'(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw:\s*DC\s*(\d+)',
        body)
    if sv:
        out['kind'] = 'save_effect'
        out['saveDC'] = int(sv.group(2))
        return out

    return out


# Approx HP / AC medians by CR tier — used to compute hp_rel and ac_rel
# signals. From the DMG 2024 monster-building tables, averaged within band.
CR_BANDS = [
    # (cr_lo, cr_hi, hp_med, ac_med)
    (0.0,  0.25,  10, 12),
    (0.5,  1.0,   25, 13),
    (2.0,  4.0,   60, 14),
    (5.0,  7.0,  110, 15),
    (8.0,  10.0, 150, 16),
    (11.0, 13.0, 200, 17),
    (14.0, 16.0, 250, 17),
    (17.0, 20.0, 305, 18),
    (21.0, 24.0, 370, 18),
    (25.0, 30.0, 460, 19),
]


def median_for_cr(cr):
    for lo, hi, hp, ac in CR_BANDS:
        if lo <= cr <= hi:
            return hp, ac
    return 100, 15  # safe default


def role_signals(m):
    actions = m.get('actions') or []
    traits = m.get('traits') or []
    reactions = m.get('reactions') or []
    bonus = m.get('bonusActions') or []
    legendary = m.get('legendaryActions') or []

    melee = ranged = save_acts = multi_count = 0
    has_spell = False

    for a in actions:
        c = classify_action(a)
        k = c['kind']
        body = (a.get('body') or '')
        if k == 'melee_attack':
            melee += 1
        elif k == 'ranged_attack':
            ranged += 1
        elif k == 'flex_attack':
            # Flex attack (Melee or Ranged) is mostly used melee — count as melee
            # for role purposes so an Ogre with a javelin doesn't read as
            # ranged-primary.
            melee += 1
        elif k == 'save_effect':
            save_acts += 1
            # Multi-effect actions like Beholder Eye Rays bundle many save
            # effects into one body. Count each additional "Saving Throw"
            # occurrence so the controller signal scales with breadth.
            extra_saves = len(re.findall(r'Saving Throw', body)) - 1
            if extra_saves > 0:
                save_acts += min(extra_saves, 4)  # cap to avoid runaway
        elif k == 'multiattack':
            mc = re.search(
                r'\bmakes\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b',
                body.lower())
            if mc:
                multi_count = NUM_WORDS.get(mc.group(1), 0)
        elif k == 'spellcasting':
            has_spell = True

    # Spellcasting can live in traits too (2014 stat blocks)
    trait_blob = ' '.join([
        (t.get('name') or '') + ' ' + (t.get('body') or '')
        for t in traits
    ]).lower()
    if 'spellcasting' in trait_blob:
        has_spell = True

    # Save-effect abilities living outside the actions list also matter
    # for role: Petrifying Gaze (bonus action), Frightful Presence (trait),
    # Death Burst (reaction), etc. Count each as one save_act.
    for entry in (traits + bonus + reactions):
        tname = (entry.get('name') or '').lower()
        tbody = (entry.get('body') or '')
        if 'spellcasting' in tname:
            continue
        if re.search(r'Saving Throw:\s*DC\s*\d+', tbody):
            save_acts += 1

    skills = m.get('skills') or {}
    skill_keys = {k.lower() for k in skills.keys()}
    has_stealth = 'stealth' in skill_keys

    has_pack = 'pack tactics' in trait_blob

    # Use word boundaries so we don't false-positive on "magicALLY", "literALLY",
    # or "INVISIBLEness" kinds of substring matches.
    def W(rx, txt):
        return bool(re.search(rx, txt))

    has_invis = W(r'\binvisibility\b', trait_blob) or W(r'\binvisible\b', trait_blob)
    # Real surprise/ambush trait names — "Surprise Attack", "Assassinate",
    # "Ambusher", etc. Excludes incidental "surprised" in lore.
    has_surprise = (
        W(r'\bsurprise attack\b', trait_blob)
        or W(r'\bassassinat', trait_blob)
        or W(r'\bambush', trait_blob)
        or W(r'\bshadow stealth\b', trait_blob)
    )

    # Healing / ally-buff signals — scan all action + trait bodies
    all_actions = actions + bonus + reactions + legendary
    body_blob = ' '.join([(a.get('body') or '') for a in all_actions]).lower()
    all_text = body_blob + ' ' + trait_blob

    # ── Heal: only ally-targeted heals count for Leader/Support. Self-heals
    # (vampire Bite, aboleth Consume Memories) shouldn't trigger this.
    has_heal = (
        W(r'\bcure wounds\b', all_text)
        or W(r'\bhealing word\b', all_text)
        or W(r'\bmass cure\b', all_text)
        or W(r'\bmass healing\b', all_text)
        or W(r'\bprayer of healing\b', all_text)
        or W(r'\bheroes.?\s*feast\b', all_text)
        or W(r'\baid spell\b', all_text)
        or W(r'\b(an?|each|one|the)\s+all(y|ies)\s+regains?\b', all_text)
        or W(r'\ball(y|ies)\s+\w+\s+regains?\b', all_text)
        or W(r'\bregains?\s+\d+\s+hit points?\s+\(?[^)]*\)?\s*to\s+(an?\s+)?ally\b', all_text)
        or W(r'\b(restores?|grants?)\s+\d+\s+hit points?\s+to\s+(an?\s+|each\s+)?(other\s+)?(ally|creature)\b', all_text)
    )

    # ── Buff: monster grants beneficial effect to allies. Word-bounded
    # "ally"/"allies" only (so "magicALLY" doesn't trip it), and only
    # specific verbs that imply giving a buff to an ally (not Pack Tactics
    # which says "if an ally IS within").
    BUFF_PATTERNS = [
        r'\ball(y|ies)\s+(can|gains?|has|have|may|takes?|regains?|moves?|gets?|adds?)\b',
        r'\beach\s+(other\s+)?all(y|ies)\b',
        r'\bone\s+all(y|ies)\b',
        r'\b(gives?|grants?|allows?)\s+(an?\s+|one\s+|each\s+|the\s+)?all(y|ies)\b',
        r'\bbardic inspiration\b',
        r'\binspires?\b',
        r'\brally\b',
        r'\b(bless|haste|aid)\s+spell\b',
        # Discrete spell names cast in support
        r'\bcommand\s+(an?|the)?\s*all(y|ies)\b',
    ]
    has_buff_allies = any(W(p, all_text) for p in BUFF_PATTERNS)

    cr = m.get('cr') or 0
    hp_med, ac_med = median_for_cr(cr)
    hp = m.get('hp') or 0
    ac = m.get('ac') or 0
    hp_rel = (hp - hp_med) / max(hp_med, 1)
    ac_rel = ac - ac_med

    speed = m.get('speed') or {}
    max_speed = max(
        (speed.get(k) or 0)
        for k in ('walk', 'fly', 'swim', 'climb', 'burrow')
    )

    return {
        'melee': melee,
        'ranged': ranged,
        'save_acts': save_acts,
        'multi_count': multi_count,
        'has_spell': has_spell,
        'has_stealth': has_stealth,
        'has_pack': has_pack,
        'has_invis': has_invis,
        'has_surprise': has_surprise,
        'has_heal': has_heal,
        'has_buff_allies': has_buff_allies,
        'has_reactions': len(reactions) > 0,
        'has_legendary': len(legendary) > 0,
        'hp_rel': hp_rel,
        'ac_rel': ac_rel,
        'max_speed': max_speed,
        'cr': cr,
    }


def infer_role(m):
    """Priority-ordered classifier → one of ROLES.

    Order matters. Pass-through ladder:
      1. Ambusher first (stealth-and-strike is a distinct play pattern)
      2. Support/Leader (ally-target heals/buffs override most other things)
      3. Controller (save-DC primary or pure spellcaster)
      4. Artillery (ranged-primary)
      5. Brute (high HP melee — checked BEFORE skirmisher so giants don't
         get flagged skirmisher just because they multiattack twice)
      6. Defender (very high AC + reactions, rare)
      7. Skirmisher (genuinely mobile or hybrid melee/ranged)
      8. Soldier (fallback for any melee-having monster)
      9. Controller (caster fallback)
     10. Soldier (final fallback)
    """
    s = role_signals(m)
    name = (m.get('name') or '').lower()
    ctype = m.get('type') or ''
    speed = m.get('speed') or {}
    walk = speed.get('walk') or 0
    fly = speed.get('fly') or 0
    swim = speed.get('swim') or 0
    total_atks = s['melee'] + s['ranged']

    # ── Ambusher ──────────────────────────────────────────────────
    # Strong explicit signals
    if s['has_invis'] and s['has_stealth']:
        return 'Ambusher'
    if s['has_surprise']:
        return 'Ambusher'
    # Stealth-themed names (catches 2024 Assassin which lost the
    # explicit Assassinate trait name but kept the archetype)
    if s['has_stealth'] and any(
        k in name for k in (
            'assassin', 'stalker', 'ambusher', 'shadow ',
            'lurker', 'doppelganger',
        )
    ):
        return 'Ambusher'

    # ── Support / Leader ──────────────────────────────────────────
    # Heals or buffs allies (ally-target only, not self-heal)
    if s['has_heal'] or s['has_buff_allies']:
        offensive = s['melee'] + s['ranged'] + s['save_acts']
        # Pure caster of buffs/heals → Support. Has offense too → Leader.
        return 'Support' if offensive <= 1 else 'Leader'

    # ── Brute ─────────────────────────────────────────────────────
    # Checked early so Giants and big dragons don't get tagged
    # Skirmisher just because they multiattack and throw rocks.
    is_big_size = m.get('size') in ('Large', 'Huge', 'Gargantuan')
    is_giant_type = ctype == 'Giant' or 'giant' in name
    high_hp = s['hp_rel'] >= 0.10
    not_controllery = s['save_acts'] <= 1  # don't steal Controllers
    # Giants are always Brutes if they swing in melee
    if is_giant_type and s['melee'] >= 1 and not_controllery:
        return 'Brute'
    # Dragons with multiattack melee → Brute (don't let Spellcasting pull
    # them into Artillery)
    if ctype == 'Dragon' and s['melee'] >= 1 and s['multi_count'] >= 3:
        return 'Brute'
    # Melee-only big HP — ogres, owlbears, etc.
    if s['melee'] >= 1 and s['ranged'] == 0 and not_controllery:
        if high_hp or (is_big_size and s['multi_count'] >= 2):
            return 'Brute'
    # Slow, big multiattackers that can also lob (Iron Golem with Fiery
    # Bolt, Stone Golem with Force Bolt) — Brute by feel
    if (is_big_size and s['melee'] >= 1 and s['multi_count'] >= 2
            and walk <= 30 and fly == 0 and not_controllery):
        return 'Brute'

    # ── Controller ────────────────────────────────────────────────
    # Save-DC primary. Multiple distinct save effects (or one multi-effect
    # body like Eye Rays — save_acts is already inflated for those) is the
    # clearest signal.
    if s['save_acts'] >= 3:
        return 'Controller'
    if s['save_acts'] >= 2 and total_atks <= s['save_acts']:
        return 'Controller'
    # Save-only profile (no weapon attacks at all)
    if s['save_acts'] >= 1 and total_atks == 0:
        return 'Controller'
    # Caster who pairs a save effect with limited weapon poke — Banshee
    # (Wail), Aboleth (Dominate Mind), Sea Hag, Dryad, etc.
    if s['has_spell'] and total_atks <= 2 and s['save_acts'] >= 1:
        return 'Controller'
    # Pure caster — no weapon, no saves — defer to Artillery below.

    # ── Artillery ─────────────────────────────────────────────────
    # Ranged-primary (archers, ranged-spell artillery, sling/bow attackers)
    if s['ranged'] > s['melee'] and s['ranged'] >= 1:
        return 'Artillery'
    # Spellcaster with an explicit ranged attack option — covers Druid
    # (Verdant Wisp), Aarakocra Aeromancer, Bog Sage, Flameskull, etc.
    # No save effects detected → not a Controller; the ranged option
    # signals shoot-from-range play pattern.
    if s['has_spell'] and s['save_acts'] == 0 and s['ranged'] >= 1:
        return 'Artillery'
    # Pure caster — no weapon, no melee. Defaults to Controller above for
    # has_spell + total_atks==0; this catches the rare residual.
    if s['has_spell'] and total_atks == 0:
        return 'Controller'

    # ── Defender ──────────────────────────────────────────────────
    # Very rare archetype. Require well-above-band AC + above-band HP +
    # reactions + melee. Knights and Veterans have Parry but should
    # default Soldier because their HP isn't notably tanky.
    if (s['ac_rel'] >= 3 and s['hp_rel'] >= 0.15
            and s['has_reactions'] and s['melee'] >= 1):
        return 'Defender'

    # ── Skirmisher ────────────────────────────────────────────────
    # Genuinely mobile — flying primary, fast walker, fast swimmer, or
    # spider-climbing (vampire-style).
    climb = speed.get('climb') or 0
    really_mobile = (
        (fly >= 40 and fly >= walk)
        or walk >= 50
        or (swim >= 40 and swim > walk)
        or (climb >= 30 and climb >= walk)
    )
    if really_mobile and total_atks >= 1:
        return 'Skirmisher'
    # Hybrid melee + ranged with multiattack — only counts when the monster
    # is at least somewhat mobile (walk 40+). Knights with longbows that
    # walk 30 are Soldiers.
    if (s['melee'] >= 1 and s['ranged'] >= 1
            and s['multi_count'] >= 2 and walk >= 40):
        return 'Skirmisher'

    # ── Caster fallback → Controller ──────────────────────────────
    # Lich, Mage, Archmage — has Spellcasting, no detected save effects,
    # no ranged option (their flex attacks count as melee). They'd
    # otherwise drop to Soldier; route them to Controller since their
    # action economy is spell-dominant.
    if s['has_spell'] and total_atks <= 2 and not is_giant_type:
        return 'Controller'

    # ── Soldier ───────────────────────────────────────────────────
    if s['melee'] >= 1:
        return 'Soldier'

    # ── Late fallbacks ────────────────────────────────────────────
    if s['has_spell']:
        return 'Controller'
    if s['ranged'] >= 1:
        return 'Artillery'
    return 'Soldier'


# ─────────────────────────────────────────────────────────────────────
# Driver
# ─────────────────────────────────────────────────────────────────────

def main():
    if not BESTIARY.exists():
        print(f'No bestiary.json found at {BESTIARY}', file=sys.stderr)
        sys.exit(1)

    data = json.loads(BESTIARY.read_text())
    monsters = data.get('monsters', [])

    role_counts = Counter()
    terrain_counts = Counter()
    tagged = 0
    preserved_role = 0
    preserved_terrain = 0

    for m in monsters:
        if m.get('roleManual'):
            preserved_role += 1
        else:
            m['role'] = infer_role(m)
        if m.get('terrainManual'):
            preserved_terrain += 1
        else:
            m['terrain'] = infer_terrain(m)
        role_counts[m.get('role') or 'Unknown'] += 1
        for t in m.get('terrain') or []:
            terrain_counts[t] += 1
        tagged += 1

    data['schemaVersion'] = max(data.get('schemaVersion', 4), 5)
    data['_taxonomy'] = {'roles': ROLES, 'terrains': TERRAINS}

    BESTIARY.write_text(json.dumps(data, indent=2))

    print(f'Tagged {tagged} monsters.')
    if preserved_role or preserved_terrain:
        print(f'  Preserved manual role on {preserved_role}, '
              f'manual terrain on {preserved_terrain}.')
    print()
    print('--- Role distribution ---')
    max_role = max(role_counts.values()) if role_counts else 1
    for role in ROLES:
        n = role_counts[role]
        bar = '█' * int(n * 36 / max_role)
        print(f'  {role:<11} {n:>4}  {bar}')
    print()
    print('--- Terrain distribution ---')
    max_t = max(terrain_counts.values()) if terrain_counts else 1
    for terr in TERRAINS:
        n = terrain_counts[terr]
        bar = '█' * int(n * 36 / max_t)
        print(f'  {terr:<11} {n:>4}  {bar}')


if __name__ == '__main__':
    main()
