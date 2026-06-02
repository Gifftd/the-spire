#!/usr/bin/env python3
"""
Extract a normalized, tier-stratified feature library from the bestiary.

Reads `bestiary.json` (which lives at the project root after
`normalize_bestiary.py` + `tag_bestiary.py` have run), walks every
monster's traits / actions / bonus actions / reactions / legendary
actions, and emits `feature_library.json` — a flat, donor-agnostic
catalog the chimera generator can pull from.

Each library entry:

    {
      "id": "Bite-low",                       # canonicalName + tier
      "canonicalName": "Bite",
      "kind": "melee_attack",                 # classifier kind
      "tier": "low",                          # low | mid | high | epic
      "tierBand": [1, 4],                     # CR band (inclusive)
      "cost": 24,                             # for the chimera's budget
      "isSignature": false,                   # true = unique to its donor(s)
      "templateFields": {...},                # composable by the page's
                                              # TEMPLATES engine (attacks/
                                              # saves) — empty for prose
      "bodyTemplate": "...",                  # body with {MONSTER} tokens,
                                              # filled at slot time
      "name": "Bite",                         # display name (recharge added
                                              # by template engine)
      "roleAffinity": ["Brute","Skirmisher"], # union of donor roles
      "terrainAffinity": ["forest","grass"],  # union of donor terrains
      "donorIds": [...],
      "donorCount": 14
    }

The library is deduplicated by (canonicalName, tier). Signature features
(unique name, single donor across the whole bestiary) keep their flavor
intact and are tagged `isSignature: true` so the generator can ration
them.

Run order:
    scripts/normalize_bestiary.py   →  bestiary.json
    scripts/tag_bestiary.py         →  bestiary.json (adds role/terrain)
    scripts/extract_features.py     →  feature_library.json
"""

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BESTIARY = ROOT / 'bestiary.json'
LIBRARY = ROOT / 'feature_library.json'

SCHEMA_VERSION = 2

# ─────────────────────────────────────────────────────────────────────
# Tiers and cost model
# ─────────────────────────────────────────────────────────────────────

# CR → tier bucket. Aligned with the chimera's slot plan in
# bestiary-dm.html so what's pulled at a given target CR feels right.
TIER_BANDS = [
    ('low',   1, 4),
    ('mid',   5, 10),
    ('high', 11, 16),
    ('epic', 17, 30),
]

def tier_for_cr(cr):
    cr = max(1, float(cr) if cr else 1)
    for name, lo, hi in TIER_BANDS:
        if lo <= cr <= hi:
            return name, [lo, hi]
    return 'epic', [17, 30]

# Mirrors KIND_COST_MULT in bestiary-dm.html.
KIND_COST_MULT = {
    'multiattack':     12,
    'melee_attack':     6, 'ranged_attack': 6, 'flex_attack': 6,
    'save_effect':     10, 'recharge_save': 10, 'recharge_attack': 8,
    'spellcasting':    14,
    'utility':          6,
    'trait':            5,
    'bonus_action':     6,
    'reaction':         6,
    'legendary':        9,
}

# ─────────────────────────────────────────────────────────────────────
# Action classifier — mirrors the JS `classifyAction` so we get the same
# kind assignment for the catalog. Plus a few extras for non-action
# sections.
# ─────────────────────────────────────────────────────────────────────

NUM_WORDS = {'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,'nine':9,'ten':10}
ABIL_LONG_TO_SHORT = {'Strength':'str','Dexterity':'dex','Constitution':'con',
                      'Intelligence':'int','Wisdom':'wis','Charisma':'cha'}

def classify_action(action, monster):
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
        kind = 'flex_attack' if m_flex else ('melee_attack' if m_melee else 'ranged_attack')
        out['kind'] = kind
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

# ─────────────────────────────────────────────────────────────────────
# Name normalization
# ─────────────────────────────────────────────────────────────────────

# Strip recharge markers / per-day limits — those go into the template
# fields, not into the canonical name. "Fire Breath (Recharge 5-6)" →
# "Fire Breath".
RECHARGE_RX = re.compile(r'\s*\((Recharge\s+[0-9–\-/]+|\d+\s*/\s*Day)\)\s*', re.IGNORECASE)

# Parenthetical form qualifiers — drop "Vampire Form Only" suffixes for
# the canonical name; the template body keeps the literal form.
FORM_QUALIFIER_RX = re.compile(r'\s*\([^)]{0,80}(only|form)[^)]{0,80}\)\s*', re.IGNORECASE)


def canonical_name(raw):
    if not raw: return ''
    n = RECHARGE_RX.sub('', raw)
    n = FORM_QUALIFIER_RX.sub('', n)
    return n.strip()


# Body template — strip the donor's identity so the same feature reads
# clean when slotted onto a different chimera. Replaces (case-insensitive)
# the lowercase donor name with `{MONSTER}` and "the {donor}" / "{donor}'s"
# patterns with their `{MONSTER}` equivalents. Doesn't touch literals
# inside damage clauses or save DCs — those flow through the template
# fields and get recomposed at slot time.
def make_body_template(body, donor_name):
    if not body or not donor_name: return body or ''
    out = body
    n = donor_name.strip()
    # Match the full donor name first (longest match), then shorter
    # forms — "Adult Red Dragon" → "{MONSTER}", "the dragon" → "the
    # {MONSTER}". Order matters so we replace specific before generic.
    candidates = [n] + [p for p in n.split() if len(p) >= 4]
    seen = set()
    for cand in candidates:
        key = cand.lower()
        if key in seen: continue
        seen.add(key)
        # case-insensitive whole-word replacement
        out = re.sub(rf"\b{re.escape(cand)}\b", '{MONSTER}', out, flags=re.IGNORECASE)
    return out


# ─────────────────────────────────────────────────────────────────────
# Template field parsers — mirror the JS `parseToTemplate` but in Python
# so the library entry can be authoritative.
# ─────────────────────────────────────────────────────────────────────

DAMAGE_CLAUSE_RX = re.compile(
    r'(\d+)\s*\(\s*(\d+d\d+(?:\s*[+\-]\s*\d+)?)\s*\)\s+(\w+)\s+damage'
)

def parse_damage_clauses(body):
    out = []
    for m in DAMAGE_CLAUSE_RX.finditer(body or ''):
        out.append({
            'avg': int(m.group(1)),
            'dice': re.sub(r'\s+', '', m.group(2)),
            'type': m.group(3),
        })
    return out

def infer_attack_ability(attack_bonus, monster, kind):
    if attack_bonus is None: return None
    pb = monster.get('pb') or 2
    abilities = monster.get('abilities') or {}
    pref = 'dex' if kind == 'ranged_attack' else 'str'
    order = ['str','dex','con','int','wis','cha']
    if pref == 'dex':
        order = ['dex','str','con','int','wis','cha']
    exact, near = None, None
    for k in order:
        v = abilities.get(k)
        if not v: continue
        total = (v.get('mod') or 0) + pb
        if total == attack_bonus and exact is None:
            exact = k
        if abs(total - attack_bonus) <= 1 and near is None:
            near = k
    return exact or near


def parse_attack_to_template(action, monster, kind):
    body = (action.get('body') or '').strip()
    name = canonical_name(action.get('name') or '')
    recharge_match = re.search(r'\((Recharge\s+[0-9–\-]+|\d+\s*/\s*Day)\)', action.get('name') or '', re.IGNORECASE)
    recharge = ''
    if recharge_match:
        recharge = recharge_match.group(1)
        recharge = re.sub(r'^Recharge\s+', '', recharge, flags=re.IGNORECASE).replace('–', '-')

    atk_match = re.search(r'(Melee or Ranged|Melee|Ranged) Attack Roll:\s*([+\-]\d+)', body)
    if not atk_match:
        return None, None
    attack_bonus = int(atk_match.group(2))
    ability = infer_attack_ability(attack_bonus, monster, kind) or ('dex' if kind == 'ranged_attack' else 'str')

    reach_match = re.search(r'reach (\d+) ft\.', body)
    range_full = re.search(r'range (\d+)/(\d+) ft\.', body)
    range_single = re.search(r'range (\d+) ft\.', body) if not range_full else None

    dmgs = parse_damage_clauses(body)
    primary = dmgs[0] if dmgs else {'dice': '1d6', 'type': 'Bludgeoning'}
    rider = dmgs[1] if len(dmgs) > 1 else None

    # Strip the bonus (`+ K`) from the dice — the template adds the
    # chimera's ability mod + magic bonus at compose time.
    dice_pure = re.sub(r'\s*[+\-]\s*\d+', '', primary['dice'])
    bonus_in_body = re.search(r'[+\-]\s*\d+', primary['dice'])
    use_ability = bool(bonus_in_body and int(bonus_in_body.group(0).replace(' ', '')) != 0)

    fields = {
        'weaponName': name or 'Attack',
        'ability': ability,
        'damageDice': dice_pure,
        'damageBonus': 0,
        'useAbilityMod': use_ability,
        'damageType': primary.get('type') or ('Slashing' if kind == 'melee_attack' else 'Piercing'),
        'riderDice': rider['dice'] if rider else '',
        'riderType': rider['type'] if rider else '',
        'recharge': recharge,
    }
    if kind == 'melee_attack':
        fields['reach'] = int(reach_match.group(1)) if reach_match else 5
    elif kind == 'ranged_attack':
        if range_full:
            fields['rangeShort'] = int(range_full.group(1))
            fields['rangeLong'] = int(range_full.group(2))
        elif range_single:
            fields['rangeShort'] = int(range_single.group(1))
            fields['rangeLong'] = int(range_single.group(1))
        else:
            fields['rangeShort'], fields['rangeLong'] = 30, 120
    elif kind == 'flex_attack':
        fields['reach'] = int(reach_match.group(1)) if reach_match else 5
        if range_full:
            fields['rangeShort'] = int(range_full.group(1))
            fields['rangeLong'] = int(range_full.group(2))
        elif range_single:
            fields['rangeShort'] = int(range_single.group(1))
            fields['rangeLong'] = int(range_single.group(1))
        else:
            fields['rangeShort'], fields['rangeLong'] = 20, 60
    return fields, name


def parse_save_to_template(action, monster):
    body = (action.get('body') or '').strip()
    name = canonical_name(action.get('name') or '')
    recharge_match = re.search(r'\((Recharge\s+[0-9–\-]+|\d+\s*/\s*Day)\)', action.get('name') or '', re.IGNORECASE)
    recharge = ''
    if recharge_match:
        recharge = recharge_match.group(1)
        recharge = re.sub(r'^Recharge\s+', '', recharge, flags=re.IGNORECASE).replace('–', '-')

    sv = re.search(r'(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw:\s*DC\s*(\d+)(?:,\s*([^.]+?)\.)?', body)
    if not sv:
        return None, None
    target_save = ABIL_LONG_TO_SHORT[sv.group(1)]
    target_clause = (sv.group(3) or 'each creature in a 30-foot Cone').strip()
    dmgs = parse_damage_clauses(body)
    success_half = bool(re.search(r'Success:\s*Half damage(?: only)?\.', body, re.IGNORECASE))

    fields = {
        'actionName': name or 'Effect',
        'targetSave': target_save,
        'dcAbility': 'con',       # default; chimera's mod drives final DC
        'target': target_clause,
        'damageDice': re.sub(r'\s*[+\-]\s*\d+', '', dmgs[0]['dice']) if dmgs else '6d6',
        'damageType': dmgs[0]['type'] if dmgs else 'Fire',
        'failureSuffix': '',
        'successHalf': success_half,
        'successSuffix': '',
        'recharge': recharge,
    }
    return fields, name


def parse_multiattack_to_template(action, monster):
    body = (action.get('body') or '').strip()
    count_match = re.search(r'\bmakes\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b', body, re.IGNORECASE)
    attack_match = re.search(
        r'\b(?:makes\s+)?(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+(\w+(?:\s+\w+)?)\s+attacks?\b',
        body, re.IGNORECASE)
    return {
        'count': NUM_WORDS.get(count_match.group(1).lower(), 2) if count_match else 2,
        'attackName': attack_match.group(1) if attack_match else '',
        'preamble': '',
        'coda': '',
    }, 'Multiattack'


def parse_spellcasting_to_template(action, monster):
    body = (action.get('body') or '').strip()
    # Detect the spell ability — "using Charisma as the spellcasting ability"
    ab_match = re.search(r'using\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)', body)
    save_ability = ABIL_LONG_TO_SHORT.get(ab_match.group(1)) if ab_match else 'cha'
    return {
        'spellAbility': save_ability,
        # Bodies are preserved verbatim (with {MONSTER} substitution +
        # {SPELL_DC} / {SPELL_ATK} placeholders applied by
        # normalize_spellcasting_body). The spell list itself doesn't
        # depend on stats; the DC + attack bonus get resolved at slot
        # time against the chimera's new ability mod + PB.
    }, canonical_name(action.get('name') or 'Spellcasting')


# Spell DCs + spell-attack bonuses inside a Spellcasting block reflect
# the donor's stats. For the chimera we strip them to placeholders that
# the page fills at slot time against the new monster's mod + PB.
SPELL_DC_RX = re.compile(r'spell save DC\s*\d+', re.IGNORECASE)
SPELL_ATK_RX = re.compile(r'\+\s*\d+\s*to hit with spell attacks', re.IGNORECASE)
# Some 2024 stat blocks embed the DC/atk in parens like "(spell save DC
# 20, +12 to hit with spell attacks)" — the same regexes catch both.


def normalize_spellcasting_body(body):
    if not body: return body
    out = body
    out = SPELL_DC_RX.sub('spell save DC {SPELL_DC}', out)
    out = SPELL_ATK_RX.sub('+{SPELL_ATK} to hit with spell attacks', out)
    return out


# ─────────────────────────────────────────────────────────────────────
# Section → kind defaults
# ─────────────────────────────────────────────────────────────────────

SECTION_KIND_DEFAULTS = {
    'traits':           'trait',
    'actions':          None,        # classify
    'bonusActions':     'bonus_action',
    'reactions':        'reaction',
    'legendaryActions': 'legendary',
}


# ─────────────────────────────────────────────────────────────────────
# Extraction driver
# ─────────────────────────────────────────────────────────────────────

def extract_one(monster):
    """Yield (kind, canonical_name, body_template, template_fields, section)
    for each feature on the monster."""
    for section, default_kind in SECTION_KIND_DEFAULTS.items():
        items = monster.get(section) or []
        for item in items:
            kind = default_kind
            if kind is None:
                kind = classify_action(item, monster)['kind']
            raw_name = item.get('name') or ''
            cname = canonical_name(raw_name)
            body = item.get('body') or ''
            body_tpl = make_body_template(body, monster.get('name') or '')

            template_fields = {}
            if kind in ('melee_attack', 'ranged_attack', 'flex_attack'):
                fields, parsed_name = parse_attack_to_template(item, monster, kind)
                if fields:
                    template_fields = fields
                    cname = parsed_name or cname
            elif kind in ('save_effect', 'recharge_save'):
                fields, parsed_name = parse_save_to_template(item, monster)
                if fields:
                    template_fields = fields
                    cname = parsed_name or cname
            elif kind == 'multiattack':
                fields, parsed_name = parse_multiattack_to_template(item, monster)
                template_fields = fields
                cname = parsed_name
            elif kind == 'spellcasting':
                fields, parsed_name = parse_spellcasting_to_template(item, monster)
                template_fields = fields
                cname = parsed_name
                # Strip donor-specific DC + spell-attack bonus to
                # placeholders so the chimera can resolve them against
                # its own stats.
                body_tpl = normalize_spellcasting_body(body_tpl)

            yield {
                'kind': kind,
                'canonicalName': cname or 'Unnamed',
                'rawName': raw_name,
                'bodyTemplate': body_tpl,
                'templateFields': template_fields,
                'section': section,
                'donor': monster,
            }


# ─────────────────────────────────────────────────────────────────────
# Aggregation across donors in the same (canonicalName, kind, tier)
# bucket. Computes per-component central tendency so the library entry
# reflects the bucket as a whole, not whichever single donor happened
# to win the highest-CR / longest-body tiebreak.
# ─────────────────────────────────────────────────────────────────────

DICE_RX = re.compile(r'^\s*(\d+)d(\d+)\s*$')

def _median(values):
    s = sorted(values)
    return s[len(s) // 2]

def _mode(values):
    if not values: return None
    return Counter(values).most_common(1)[0][0]

def aggregate_template_fields(bucket):
    """Aggregate templateFields across donors in a bucket.

    Per-component rules:
      - dice strings (NdM):  median dice count + median die size
      - reach / range / count / bonuses: median
      - damageType / weaponName / actionName / recharge: mode (most common)
      - booleans: majority vote
      - all other strings: first non-empty
    """
    field_values = defaultdict(list)
    for f in bucket:
        tf = f.get('templateFields') or {}
        for k, v in tf.items():
            field_values[k].append(v)

    out = {}
    for k, vs in field_values.items():
        if not vs: continue
        sample = vs[0]
        # Dice formula: median dice count + median die size
        if isinstance(sample, str) and DICE_RX.match(sample or ''):
            counts, sizes = [], []
            for v in vs:
                m = DICE_RX.match(v or '')
                if m:
                    counts.append(int(m.group(1)))
                    sizes.append(int(m.group(2)))
            if counts:
                out[k] = f'{_median(counts)}d{_median(sizes)}'
            else:
                out[k] = _mode([v for v in vs if v]) or sample
        # Numeric: median
        elif isinstance(sample, (int, float)) and not isinstance(sample, bool):
            nums = [v for v in vs if isinstance(v, (int, float)) and not isinstance(v, bool)]
            out[k] = _median(nums) if nums else sample
        # Boolean: majority vote
        elif isinstance(sample, bool):
            bools = [bool(v) for v in vs]
            out[k] = bools.count(True) > bools.count(False)
        # String (recharge, type, name): mode
        else:
            out[k] = _mode(vs)
    return out


def build_library(bestiary_data):
    monsters = bestiary_data.get('monsters') or []
    # Bucket: keyed by (canonicalName, kind, tier) → list of donor instances
    buckets = defaultdict(list)
    name_donors = defaultdict(set)         # canonicalName → set(donorIds)

    for m in monsters:
        if not m.get('cr'): continue
        tier_name, _ = tier_for_cr(m['cr'])
        for f in extract_one(m):
            cname = f['canonicalName']
            kind = f['kind']
            # Multiattack is always synthesized at slot-time from the
            # chimera's actual attacks — no library entry needed.
            if kind == 'multiattack':
                continue
            key = (cname, kind, tier_name)
            buckets[key].append(f)
            name_donors[cname].add(m.get('id'))

    # Build library entries with aggregated metadata
    entries = []
    for (cname, kind, tier_name), donors in buckets.items():
        if not donors: continue
        tier_band = next((band for n, *band in [(n, lo, hi) for n,lo,hi in TIER_BANDS] if n == tier_name), [1, 4])
        # Cost: kind multiplier × representative CR for the tier (the
        # tier midpoint, so CR-band-low items get low-CR-band cost).
        tier_cr_repr = (tier_band[0] + tier_band[1]) / 2
        cost = max(1, round(tier_cr_repr * (KIND_COST_MULT.get(kind) or 3)))

        # Aggregate role / terrain affinity across the donor monsters
        role_set, terrain_set = set(), set()
        donor_ids = []
        for f in donors:
            d = f['donor']
            if d.get('role'): role_set.add(d['role'])
            for t in (d.get('terrain') or []): terrain_set.add(t)
            donor_ids.append(d.get('id'))

        # Signature: this canonical name appears in only one donor across
        # the entire bestiary AND that donor is the only one contributing
        # this exact (kind, tier) tuple. Used to gate rare features.
        is_signature = len(name_donors[cname]) == 1

        # templateFields: aggregate per-component across all donors so
        # the entry reflects central tendency (median dice, mode types,
        # majority booleans) rather than one donor's quirks.
        aggregated_fields = aggregate_template_fields(donors)

        # bodyTemplate: prose kinds (traits, spellcasting, utility,
        # bonus, reaction, legendary) need a representative body. Pick
        # the donor closest to the tier midpoint so the wording matches
        # the central case rather than the strongest outlier.
        tier_mid = (tier_band[0] + tier_band[1]) / 2
        rep = min(donors, key=lambda x: abs((+(x['donor'].get('cr') or 0)) - tier_mid))
        body_tpl = rep['bodyTemplate']

        entries.append({
            'id': f'{cname}-{kind}-{tier_name}'.replace(' ', '_'),
            'canonicalName': cname,
            'name': cname,
            'kind': kind,
            'tier': tier_name,
            'tierBand': tier_band,
            'cost': cost,
            'isSignature': is_signature,
            'templateFields': aggregated_fields,
            'bodyTemplate': body_tpl,
            'roleAffinity': sorted(role_set),
            'terrainAffinity': sorted(terrain_set),
            'donorIds': sorted(set(donor_ids)),
            'donorCount': len(set(donor_ids)),
        })

    return entries


def main():
    if not BESTIARY.exists():
        print(f'No bestiary.json found at {BESTIARY}', file=sys.stderr)
        sys.exit(1)

    data = json.loads(BESTIARY.read_text())
    entries = build_library(data)

    out = {
        'schemaVersion': SCHEMA_VERSION,
        'extractedFrom': data.get('source') or 'bestiary',
        'monsterCount': len(data.get('monsters') or []),
        'featureCount': len(entries),
        'features': entries,
    }

    LIBRARY.write_text(json.dumps(out, indent=2))

    # Summary stats
    print(f'Extracted {len(entries)} features from {len(data.get("monsters") or [])} monsters.')
    print()
    print('--- Features by kind ---')
    by_kind = Counter(e['kind'] for e in entries)
    for k, n in by_kind.most_common():
        print(f'  {k:<18} {n}')
    print()
    print('--- Features by tier ---')
    by_tier = Counter(e['tier'] for e in entries)
    for t in ['low','mid','high','epic']:
        print(f'  {t:<6} {by_tier.get(t, 0)}')
    print()
    print(f'Signature features: {sum(1 for e in entries if e["isSignature"])}')
    print(f'Common features:    {sum(1 for e in entries if not e["isSignature"])}')
    print()
    print(f'Wrote {LIBRARY}')


if __name__ == '__main__':
    main()
