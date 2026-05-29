#!/usr/bin/env python3
"""
Normalize a raw DDB bestiary scrape into the project's canonical schema.

Input  (default): ./mm2024.json   — output of the Chrome-side scraper
Output (default): ./bestiary.json — what the DM will Import into KV

The normalizer is additive: every raw field is preserved, structured siblings
are added next to them. Re-runnable.

Usage:
    python3 scripts/normalize_bestiary.py
    python3 scripts/normalize_bestiary.py mm2024.json bestiary.json
"""

import datetime
import json
import re
import sys
from pathlib import Path

SCHEMA_VERSION = 3  # +lairEffects via patch file (covers monsters whose text the scraper missed)

# Optional patch input: when present at the project root (default
# `mm2024-lair-patch.json`), the file contributes lair-effects sections the
# original DDB scrape dropped — monsters like the Adult/Ancient dragons whose
# lair text lives in a separate <h3 id="...Lairs"> section on the source page
# rather than inline in the monster's description. The patch is gitignored
# (third-party content) and produced by `scripts/scrape_lair_effects.js`.
PATCH_PATH_DEFAULT = "mm2024-lair-patch.json"

SIZE_WORDS = {"Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"}

# Lair-effects parser. The 2024 MM uses "Lair Effects" (passive environment
# changes) instead of 2014's "Lair Actions". The scraper rolled the effects
# text into `description` instead of capturing them as a structured section,
# but the format is consistent enough to extract by regex:
#
#   "...creating the following effects: <Title>. <body...> <Title>. <body...>
#    If <monster> dies/is destroyed or moves its lair elsewhere, these effects
#    end immediately..."
#
# A token in an effect title must be either Title-Cased ("Foul", "All-Seeing")
# or one of a small joiner set ("and", "of", "the", "in") — this distinguishes
# titles like "Sea and Storms." from body sentences like "Creatures within..."
# whose second word is lowercase.
_EFFECT_TOKEN = r"(?:[A-Z][\w\-’']*|and|of|the|in)"
_EFFECT_NAME = rf"{_EFFECT_TOKEN}(?:\s+{_EFFECT_TOKEN}){{0,3}}"
_RE_LAIR_START = re.compile(r"creating the following effects:\s*")
_RE_LAIR_END = re.compile(
    r"\.\s+If\s+\w+(?:\s+\w+){0,5}\s+(?:dies|is destroyed|moves its lair)"
)
_RE_EFFECT = re.compile(rf"(?:^|(?<=\.\s))({_EFFECT_NAME})\.\s+(?=[A-Z])")


def extract_lair_effects(desc: str) -> list[dict]:
    if not desc:
        return []
    m_start = _RE_LAIR_START.search(desc)
    if not m_start:
        return []
    body = desc[m_start.end():]
    m_end = _RE_LAIR_END.search(body)
    if m_end:
        # Keep the period that closes the last effect's body.
        body = body[: m_end.start() + 1]
    matches = list(_RE_EFFECT.finditer(body))
    out = []
    for i, m in enumerate(matches):
        name = m.group(1)
        b_start = m.end()
        b_end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        text = body[b_start:b_end].strip().rstrip(".")
        if text:
            out.append({"name": name, "body": text + "."})
    return out


def split_csv(text: str) -> list[str]:
    """Split a comma list, trim, drop empties. Parentheticals stay attached."""
    if not text:
        return []
    # Don't split commas inside parentheses.
    out, buf, depth = [], [], 0
    for ch in text:
        if ch == "(":
            depth += 1
            buf.append(ch)
        elif ch == ")":
            depth = max(0, depth - 1)
            buf.append(ch)
        elif ch == "," and depth == 0:
            piece = "".join(buf).strip()
            if piece:
                out.append(piece)
            buf = []
        else:
            buf.append(ch)
    tail = "".join(buf).strip()
    if tail:
        out.append(tail)
    return out


def parse_immunities(text: str) -> tuple[list[str], list[str]]:
    """
    DDB packs damage immunities and condition immunities into one string,
    separated by ';'. Example:
        "Poison, Thunder; Exhaustion, Grappled, Paralyzed"
    Either half can be absent.
    """
    if not text:
        return [], []
    parts = text.split(";", 1)
    damage = split_csv(parts[0]) if len(parts) >= 1 else []
    cond = split_csv(parts[1]) if len(parts) == 2 else []
    return damage, cond


def normalize_size_and_type(m: dict) -> tuple[str, list[str], str, list[str]]:
    """
    Repair the 'Medium or Small Humanoid' parse artifact.

    DDB headers like "Medium or Small Humanoid" got split as
    size="Medium", type="or Small Humanoid". When that pattern is detected,
    we strip the prefix and produce a sizes list.

    Also splits dual-types like "Celestial or Fiend" into a types list.

    Returns (primarySize, sizes, primaryType, types).
    """
    size = m.get("size", "") or ""
    typ = (m.get("type", "") or "").strip()
    sizes = [size] if size else []

    # 'or Small Humanoid' / 'or Gargantuan Undead' / 'or Large Dragon'
    mo = re.match(r"^or\s+(Tiny|Small|Medium|Large|Huge|Gargantuan)\s+(.+)$", typ)
    if mo:
        sizes.append(mo.group(1))
        typ = mo.group(2).strip()

    # 'Celestial or Fiend' (dual type, single size)
    if " or " in typ:
        parts = [p.strip() for p in typ.split(" or ") if p.strip()]
        # Don't fragment "Swarm of Tiny Beasts" — those have no ' or '.
        types = parts
        primary_type = parts[0]
    else:
        types = [typ] if typ else []
        primary_type = typ

    # Dedupe while preserving order.
    sizes = list(dict.fromkeys(sizes))
    types = list(dict.fromkeys(types))

    return size, sizes, primary_type, types


def candidate_lair_section_ids(m: dict) -> list[str]:
    """
    Derive candidate `<h3 id="...">` section IDs from a monster's name + group.

    The 2024 MM keys lair sections by lineage, not by individual statblock:
    Adult Black Dragon and Ancient Black Dragon both reference
    `#BlackDragonLairs`. We try (in order): the name minus an Adult/Ancient
    prefix and any role suffix, the raw stripped name, the monster's `group`
    field, and the unmodified name. The first key present in the patch wins.
    """
    cands: list[str] = []
    name = m.get("name", "") or ""
    group = (m.get("group") or "").strip()
    stripped = re.sub(r"^(?:Adult|Ancient|Young)\s+", "", name)
    # Drop trailing role/specialization suffixes (Sphinx of Lore → Sphinx,
    # Vampire Umbral Lord → Vampire).
    base = re.sub(r"\s+(?:of\s+\w+|Umbral\s+\w+|Lord|Captain|Stalker)$", "", stripped)
    for cand in [stripped, base, group, name]:
        if not cand:
            continue
        key = re.sub(r"[\s\-]+", "", cand) + "Lairs"
        if key not in cands:
            cands.append(key)
    return cands


def apply_lair_patch(monsters: list[dict], patch: dict) -> tuple[int, list[str]]:
    """
    Fill in `lairEffects` for monsters where the patch carries the relevant
    section. Returns (n_applied, unmatched_names) — `unmatched_names` lists
    monsters that have `xpInLair` set but couldn't be resolved via the patch
    (and didn't already get effects from the description-prose parser).
    """
    sections = (patch or {}).get("sections", {}) if isinstance(patch, dict) else {}
    n_applied = 0
    unmatched: list[str] = []
    for m in monsters:
        # Only consider monsters with a lair (per `xpInLair`) that the prose
        # parser couldn't already populate.
        if not m.get("xpInLair"):
            continue
        if m.get("lairEffects"):
            continue
        section_id = next(
            (k for k in candidate_lair_section_ids(m) if k in sections), None
        )
        if section_id:
            effects = sections[section_id].get("effects", [])
            if effects:
                m["lairEffects"] = effects
                n_applied += 1
                continue
        unmatched.append(m.get("name", "?"))
    return n_applied, unmatched


def normalize_monster(m: dict) -> dict:
    out = dict(m)  # preserve every original field

    size, sizes, typ, types = normalize_size_and_type(m)
    out["size"] = size
    out["sizes"] = sizes
    out["type"] = typ
    out["types"] = types

    out["resistances"] = split_csv(m.get("resistancesText", ""))
    out["vulnerabilities"] = split_csv(m.get("vulnerabilitiesText", ""))
    dmg_imm, cond_imm = parse_immunities(m.get("immunitiesText", ""))
    out["damageImmunities"] = dmg_imm
    out["conditionImmunities"] = cond_imm

    # Lair Effects — extract from description prose where the scraper left them.
    # Doesn't touch existing `lairActions` (the 2014-style field), which the
    # 2024 MM doesn't populate.
    out["lairEffects"] = extract_lair_effects(m.get("description", "") or "")

    return out


def normalize(raw: dict, patch: dict | None = None) -> dict:
    monsters = [normalize_monster(m) for m in raw.get("monsters", [])]
    patch_applied, patch_unmatched = (0, [])
    if patch:
        patch_applied, patch_unmatched = apply_lair_patch(monsters, patch)
    out = {
        "schemaVersion": SCHEMA_VERSION,
        "source": raw.get("source"),
        "scrapedAt": raw.get("scrapedAt"),
        "normalizedAt": datetime.datetime.now(datetime.timezone.utc)
        .strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(monsters),
        "monsters": monsters,
    }
    out["_patch"] = {
        "applied": patch_applied,
        "stillMissing": patch_unmatched,
    }
    return out


def main() -> int:
    here = Path(__file__).resolve().parent.parent
    in_path = Path(sys.argv[1]) if len(sys.argv) > 1 else here / "mm2024.json"
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else here / "bestiary.json"

    if not in_path.exists():
        print(f"input not found: {in_path}", file=sys.stderr)
        return 1

    raw = json.loads(in_path.read_text(encoding="utf-8"))
    patch_path = here / PATCH_PATH_DEFAULT
    patch = None
    if patch_path.exists():
        try:
            patch = json.loads(patch_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            print(f"warning: could not parse {patch_path}: {e}", file=sys.stderr)
    norm = normalize(raw, patch)
    out_path.write_text(
        json.dumps(norm, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    # Summary so the user can spot-check at a glance.
    ms = norm["monsters"]
    fixed_type = sum(1 for m in ms if m.get("sizes") and len(m["sizes"]) > 1)
    with_res = sum(1 for m in ms if m["resistances"])
    with_dmg_imm = sum(1 for m in ms if m["damageImmunities"])
    with_cond_imm = sum(1 for m in ms if m["conditionImmunities"])
    with_vuln = sum(1 for m in ms if m["vulnerabilities"])
    with_lair_eff = sum(1 for m in ms if m["lairEffects"])
    total_lair_eff = sum(len(m["lairEffects"]) for m in ms)
    print(f"wrote {out_path} ({len(ms)} monsters, schemaVersion={SCHEMA_VERSION})")
    print(f"  size/type repairs:       {fixed_type}")
    print(f"  with damage resistances: {with_res}")
    print(f"  with damage immunities:  {with_dmg_imm}")
    print(f"  with condition immune:   {with_cond_imm}")
    print(f"  with vulnerabilities:    {with_vuln}")
    print(f"  with lair effects:       {with_lair_eff} ({total_lair_eff} effects total)")
    if patch is not None:
        info = norm.get("_patch") or {}
        print(
            f"  patch:                   {info.get('applied', 0)} monsters filled from {patch_path.name}"
        )
        miss = info.get("stillMissing") or []
        if miss:
            print(
                f"    still missing (no patch match for these xpInLair monsters):"
            )
            for n in miss:
                print(f"      - {n}")
    elif (here / PATCH_PATH_DEFAULT).exists():
        pass  # already warned during parse
    else:
        print(
            f"  patch:                   no {PATCH_PATH_DEFAULT} found — skipped"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
