#!/usr/bin/env python3
"""
Extract monster stat blocks from Tome of Beasts (Kobold Press, 2017, 2014 5e).

Input:  ./Kobold-Press-Tome-of-Beasts-V3_5aa2f7a808892 (1).pdf  (or pass a path)
Output: ./tob.json — a {source, scrapedAt, count, monsters:[...]} envelope shaped
        like mm2024.json, ready for scripts/normalize_bestiary.py.

Strategy:
1. Column-aware text extraction. Each page is two columns at x≈290; the
   reading flow is all-of-left-col (top→bottom), then all-of-right-col.
2. Build a single linear line-stream across all bestiary pages, dropping
   chrome (page header, watermark, page numbers, drop-caps).
3. Find each monster's anchor: a "<size> <type>, <alignment>" line whose
   next non-empty line is "Armor Class …".
4. For each anchor, gather the stat-block FIELD LINES (Armor Class, Hit
   Points, Speed, the STR/DEX header + row, Saving Throws, Skills, the four
   damage/condition lines, Senses, Languages, Challenge). Continuation
   lines (multi-line values like a long resistance list) get joined into
   their parent label until the next known label appears. This handles the
   wrap-line bug from the first pass.
5. After Challenge, walk forward parsing traits + section-headed bodies
   (ACTIONS / REACTIONS / LEGENDARY ACTIONS / BONUS ACTIONS / LAIR ACTIONS /
   REGIONAL EFFECTS). Each feature is a Title-Case name followed by ". <body>"
   with continuation lines.
6. Stop when the next monster anchor or a hard page break appears.
7. Transform action bodies from 2014 → 2024 phrasing so the result plugs
   into the existing bestiary schema (Melee Weapon Attack → Melee Attack
   Roll, drop "one target/creature.", title-case damage types).
8. Stamp each monster with source='tob-v1' for distinguishable concatenation
   into bestiary.json.

Usage:
    python3 scripts/extract_tob.py            # uses default PDF + tob.json
    python3 scripts/extract_tob.py <in.pdf> <out.json>
"""

import datetime
import json
import re
import sys
from pathlib import Path

import pdfplumber

DEFAULT_PDF = "Kobold-Press-Tome-of-Beasts-V3_5aa2f7a808892 (1).pdf"
DEFAULT_OUT = "tob.json"
SOURCE_TAG = "tob-v1"

# Bestiary page range (PDF indices, 0-based). Bestiary = printed 8..416.
START_PAGE_INDEX = 7
END_PAGE_INDEX = 416     # exclusive

# Column split — empirically validated against multiple sample pages.
COLUMN_SPLIT_X = 290

# Page chrome filters.
WATERMARK_RX = re.compile(r"Jacob Gifford\s*-\s*jgifford@gmail\.com\s*-\s*\d+")
PAGE_HEADER_RX = re.compile(r"^[A-Z]\s+•\s+TOME OF BEASTS$|^TOME OF BEASTS\s+•\s+[A-Z]$|^•\s+[A-Z]$|^[A-Z]\s+•$")
PAGE_NUMBER_RX = re.compile(r"^\d{1,3}$")

# Stat-block anchor — "Large undead, chaotic evil" style.
SIZE_TYPE_RX = re.compile(
    r"^(Tiny|Small|Medium|Large|Huge|Gargantuan)\s+([A-Za-z][A-Za-z\s,'-]*?),\s+(.+)$"
)

# Stat-block field labels in their canonical order. Used to detect "this line
# starts a new field" so continuation lines can be glued onto the previous one.
FIELD_LABELS = [
    "Armor Class",
    "Hit Points",
    "Speed",
    "STR DEX CON INT WIS CHA",   # header
    "Saving Throws",
    "Skills",
    "Damage Vulnerabilities",
    "Damage Resistances",
    "Damage Immunities",
    "Condition Immunities",
    "Senses",
    "Languages",
    "Challenge",
]

# Section headers (case-insensitive at start of line).
SECTION_HEADERS = {
    "ACTIONS": "actions",
    "REACTIONS": "reactions",
    "LEGENDARY ACTIONS": "legendaryActions",
    "BONUS ACTIONS": "bonusActions",
    "LAIR ACTIONS": "lairActions",
    "REGIONAL EFFECTS": "lairEffects",
}

# Ability table row — six "score (mod)" pairs in sequence. Unicode minus (‒, −)
# is accepted.
ABILITY_HEADER_RX = re.compile(r"^STR\s+DEX\s+CON\s+INT\s+WIS\s+CHA\s*$")
ABILITY_ROW_RX = re.compile(
    r"^(\d+)\s*\(([+\-‒−–]\d+)\)\s+"
    r"(\d+)\s*\(([+\-‒−–]\d+)\)\s+"
    r"(\d+)\s*\(([+\-‒−–]\d+)\)\s+"
    r"(\d+)\s*\(([+\-‒−–]\d+)\)\s+"
    r"(\d+)\s*\(([+\-‒−–]\d+)\)\s+"
    r"(\d+)\s*\(([+\-‒−–]\d+)\)\s*$"
)

# Challenge: "Challenge 12 (8,400 XP)"; CR may be 1/8, 1/4, 1/2, or integer.
CR_RX = re.compile(r"^(\d+(?:/\d+)?|¼|½)\s*(?:\(\s*([0-9,]+)\s*XP\s*\))?")

# Hit Points: "135 (18d10 + 36)" — outer paren may be missing for ToB stub rows.
HP_RX = re.compile(r"^(\d+)\s*\((.+?)\)\s*$|^(\d+)\s*$")

# AC: "17 (natural armor)" or "17" or "17 (16 with mage armor)".
AC_RX = re.compile(r"^(\d+)(?:\s*\((.+?)\))?\s*$")


# ── Column-aware page-line extraction ──────────────────────────────────────

def page_lines_columnwise(page):
    """
    Returns a list of cleaned text lines for one page in reading order:
    left column (top→bottom), then right column (top→bottom). Page chrome
    is filtered out. Each entry is just a string — we lose y-coords but
    that's fine for the stream-based parsing below.
    """
    words = page.extract_words(x_tolerance=2, y_tolerance=2,
                                keep_blank_chars=False, use_text_flow=False)
    if not words:
        return []
    left = [w for w in words if w["x0"] < COLUMN_SPLIT_X]
    right = [w for w in words if w["x0"] >= COLUMN_SPLIT_X]
    out = []
    for col in (left, right):
        for ln in group_words_into_lines(col):
            if is_chrome(ln):
                continue
            out.append(ln)
    return out

def group_words_into_lines(words, y_tolerance=3):
    if not words:
        return []
    words = sorted(words, key=lambda w: (w["top"], w["x0"]))
    lines, cur, cur_top = [], [words[0]], words[0]["top"]
    for w in words[1:]:
        if abs(w["top"] - cur_top) <= y_tolerance:
            cur.append(w)
        else:
            cur.sort(key=lambda x: x["x0"])
            lines.append(" ".join(x["text"] for x in cur))
            cur, cur_top = [w], w["top"]
    cur.sort(key=lambda x: x["x0"])
    lines.append(" ".join(x["text"] for x in cur))
    return lines

def is_chrome(line):
    s = line.strip()
    if not s:
        return True
    if WATERMARK_RX.search(s):
        return True
    if PAGE_HEADER_RX.match(s):
        return True
    if PAGE_NUMBER_RX.match(s) and len(s) <= 3:
        return True
    if s == "TOME OF BEASTS" or s.startswith("TOME OF BEASTS "):
        return True
    return False

def fix_dropcaps(lines):
    """
    Glue drop-cap fragments back together. Patterns we see:
      ["A", "boleth, ihileth"]               → "Aboleth, Nihileth"
      ["a", "n", "Boleth ihileth"]           → "Aboleth Nihileth"   (rare)
      ["a", "lgorith"]                       → "Algorith"
    Strategy: if a line is exactly one capital letter and the NEXT line starts
    with lowercase (and is short-ish, indicating a name continuation), glue.
    Also handles 2-letter drop-cap pairs.
    """
    out = []
    i = 0
    while i < len(lines):
        cur = lines[i].strip()
        if (len(cur) == 1 and cur.isalpha()
                and i + 1 < len(lines)
                and lines[i + 1]
                and lines[i + 1][0].islower()):
            # Drop-cap + rest
            out.append(cur + lines[i + 1])
            i += 2
            continue
        out.append(lines[i])
        i += 1
    return out


# ── Linear stream + anchors ────────────────────────────────────────────────

def build_stream(pdf_path):
    """Concatenate all bestiary-page lines into one stream with provenance."""
    stream = []
    page_for_line = []
    with pdfplumber.open(pdf_path) as pdf:
        end = min(END_PAGE_INDEX, len(pdf.pages))
        for idx in range(START_PAGE_INDEX, end):
            page = pdf.pages[idx]
            lines = page_lines_columnwise(page)
            lines = fix_dropcaps(lines)
            for ln in lines:
                stream.append(ln)
                page_for_line.append(idx + 1)
    return stream, page_for_line

def find_anchors(stream):
    """
    A monster anchor is a "<size> <type>, <alignment>" line followed within
    a few lines by an "Armor Class …" line. Returns a list of dicts:
      { name, nameIdx, sizeTypeIdx, acIdx }
    """
    out = []
    for i, raw in enumerate(stream):
        line = raw.strip()
        m = SIZE_TYPE_RX.match(line)
        if not m:
            continue
        # Look forward up to 3 lines for "Armor Class …".
        ac_idx = None
        for j in range(i + 1, min(i + 4, len(stream))):
            if stream[j].strip().startswith("Armor Class"):
                ac_idx = j
                break
        if ac_idx is None:
            continue
        # Find name — walk up from the size/type line skipping empty.
        name_idx = i - 1
        while name_idx > 0 and not stream[name_idx].strip():
            name_idx -= 1
        out.append({
            "name": stream[name_idx].strip() if name_idx >= 0 else "(unknown)",
            "nameIdx": name_idx,
            "sizeTypeIdx": i,
            "acIdx": ac_idx,
        })
    return out


# ── Stat-block field gatherer (continuation-line aware) ────────────────────

def gather_fields(stream, start_idx, stop_idx):
    """
    Starting at `start_idx` (the Armor Class line), walk forward joining
    continuation lines into their parent label until we hit either:
      - the Challenge line (then we return — traits/actions come after)
      - a section header (ACTIONS / REACTIONS / etc.)
      - `stop_idx` (next monster anchor)

    Returns (fields_dict, post_idx) where post_idx is the index AFTER the
    challenge line — where trait parsing should resume.
    """
    fields = {}
    current_label = None
    current_value = []

    def flush():
        nonlocal current_label, current_value
        if current_label is not None:
            joined = " ".join(s.strip() for s in current_value).strip()
            # Normalize internal whitespace.
            joined = re.sub(r"\s+", " ", joined)
            fields[current_label] = joined
        current_label = None
        current_value = []

    i = start_idx
    while i < stop_idx:
        line = stream[i].strip()
        # Section header? Stop gathering fields.
        if line.upper() in SECTION_HEADERS:
            flush()
            return fields, i
        # Match a known label.
        matched = None
        for label in FIELD_LABELS:
            if line == label:
                matched = (label, "")
                break
            if line.startswith(label + " "):
                matched = (label, line[len(label):].strip())
                break
        if matched:
            flush()
            current_label, current_value = matched[0], [matched[1]] if matched[1] else []
            # Special case: when current label is Challenge, the next non-empty
            # line that doesn't start with a known label is a trait-paragraph,
            # not a continuation. We'll let the regular continuation-join
            # logic run for ONE iteration then return.
            if matched[0] == "Challenge":
                i += 1
                # Drain any continuation that's clearly part of the XP line
                # (rare — most Challenge lines are single-line).
                while i < stop_idx:
                    nxt = stream[i].strip()
                    if not nxt:
                        i += 1
                        continue
                    # If the next line looks like a label, a section header,
                    # or a trait name, stop.
                    if nxt.upper() in SECTION_HEADERS:
                        break
                    if any(nxt.startswith(l + " ") or nxt == l for l in FIELD_LABELS):
                        break
                    if looks_like_trait_or_action_name(nxt):
                        break
                    # Otherwise treat as a Challenge continuation (rare).
                    current_value.append(nxt)
                    i += 1
                flush()
                return fields, i
        elif current_label is not None:
            # Continuation line for the current label.
            current_value.append(line)
        # else: skip stray lines before any field.
        i += 1
    flush()
    return fields, i


# ── Traits + section-headed feature parsing ────────────────────────────────

TRAIT_NAME_RX = re.compile(r"^([A-Z][A-Za-z0-9'’\-\s/]+?)(?:\s+\([^)]+\))?[.:]\s+(.+)$")
SAFE_NAME_WORDS = {"and","or","of","the","in","on","with","by","from","a","an","to","at"}
# Lines that look like feature names but never actually are. Ability score
# names get embedded in "Innate Spellcasting" prose ("…ability is Charisma
# (spell save DC 16). It can innately cast…") and would otherwise be mis-
# tagged as their own feature.
FEATURE_NAME_DENYLIST = {
    "Strength","Dexterity","Constitution","Intelligence","Wisdom","Charisma",
    "Hit","Failure","Success","Trigger","Response","Variant","Variants",
    "Note","Notes","Optional",
}

def looks_like_trait_or_action_name(line):
    """
    Detect a feature name: 1-7 Title-Case-ish words ending in '.' or ':'
    followed by body text on the same line. Rejects denied lead words
    (ability score names like "Charisma", header words like "Failure",
    "Success", "Trigger" that show up inside other features' bodies).
    """
    m = TRAIT_NAME_RX.match(line)
    if not m:
        return False
    name = m.group(1).strip()
    if name in FEATURE_NAME_DENYLIST:
        return False
    words = name.split()
    if len(words) > 8:
        return False
    for j, w in enumerate(words):
        w2 = w.lstrip("‒-–—’'\"").strip()
        if not w2:
            continue
        if j > 0 and w2.lower() in SAFE_NAME_WORDS:
            continue
        if not w2[0].isupper():
            return False
    return True

GAME_MECHANIC_RX = re.compile(
    r"Attack Roll:|Weapon Attack:|saving throw|\bDC\s+\d+|damage[.,]|\d+d\d+|Hit:|"
    r"reach\s+\d+\s*ft|range\s+\d+|\bspell\b|spellcasting|\bcasts\b|"
    r"makes\b[^.]{0,150}attacks?\b|"
    r"recharge|\blegendary\b|takes?\s+\d+\s*\(\d+d\d+|"
    r"\b(?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\b|"
    # Utility-action vocabulary common in 2014 stat blocks.
    r"\bas\s+(?:a|an)\s+(?:bonus|reaction)\b|\bat\s+will\b|"
    r"\bhit\s+points?\b|\bregain(?:s)?\s+hit\s+points?\b|\bcondition\b|"
    r"\bmagical(?:ly)?\b|\bteleport(?:s)?\b|\binitiative\b|"
    r"\bdisadvantage\b|\badvantage\s+on\b|\bcharmed\b|\bgrappled\b|\bfrightened\b|\bpoisoned\b",
    re.I,
)
def is_game_mechanic_body(text):
    """
    Heuristic: does this body text contain D&D game-mechanic markers? Used to
    distinguish real trait/action bodies (which always do) from lore-prose
    intros of the NEXT monster (which never do). Catches cases where the
    feature-name regex would match a lore section heading like
    "Foes of Chaos." or "Creatures of Pure Reason."
    """
    return bool(GAME_MECHANIC_RX.search(text or ""))

def parse_features(stream, start_idx, stop_idx, monster):
    """
    From after-Challenge to stop_idx, split into the trait/section-headed
    feature lists on `monster`. Each feature is `{name, body}`.

    Stops parsing if it encounters a feature whose body looks like lore
    prose (no game-mechanic markers) — that signals we've crossed into the
    next monster's description block.
    """
    section = "traits"
    current = None
    buf = []
    consecutive_lore = 0   # how many features in a row had no game-mechanic body

    def flush():
        nonlocal current, buf
        if current is not None:
            body = " ".join(buf).strip()
            body = re.sub(r"\s+", " ", body)
            target = section
            if section in ("actions","reactions","bonusActions","legendaryActions"):
                body = transform_action_body(body)
            current["body"] = body
            monster[target].append(current)
        current = None
        buf = []

    i = start_idx
    while i < stop_idx:
        line = stream[i].strip()
        if not line:
            i += 1
            continue
        upper = line.upper().strip(":")
        if upper in SECTION_HEADERS:
            flush()
            section = SECTION_HEADERS[upper]
            consecutive_lore = 0
            i += 1
            continue
        m = TRAIT_NAME_RX.match(line)
        if m and looks_like_trait_or_action_name(line):
            # Before committing the previous feature, check the lore-bleed gate:
            # if the previous feature is in an actions section and its body has
            # no game-mechanic markers, retract it and stop. We've crossed into
            # the next monster's lore.
            if (current is not None
                    and section in ("actions","reactions","bonusActions","legendaryActions","lairActions","lairEffects")
                    and not is_game_mechanic_body(" ".join(buf))):
                consecutive_lore += 1
                # Drop the current — don't flush.
                current = None
                buf = []
                if consecutive_lore >= 1:
                    # One non-mechanic feature is enough — we're definitely in
                    # the next monster's lore.
                    return
            else:
                flush()
                consecutive_lore = 0
            name = m.group(1).strip()
            name_with_paren_rx = re.compile(r"^([A-Z][A-Za-z0-9'’\-\s/]+?(?:\s+\([^)]+\))?)\.\s+(.+)$")
            m2 = name_with_paren_rx.match(line)
            if m2 and m2.group(1):
                name = m2.group(1).strip()
            current = {"name": name, "body": ""}
            buf = [m.group(2).strip()]
            i += 1
            continue
        if current is not None:
            buf.append(line)
        i += 1
    # Final flush — apply the same lore-bleed gate at the end.
    if (current is not None
            and section in ("actions","reactions","bonusActions","legendaryActions","lairActions","lairEffects")
            and not is_game_mechanic_body(" ".join(buf))):
        return
    flush()


# ── Per-field parsing helpers ──────────────────────────────────────────────

def parse_size_type(line):
    m = SIZE_TYPE_RX.match(line.strip())
    if not m:
        return None
    size, raw_type, alignment = m.group(1), m.group(2).strip(), m.group(3).strip()
    subtype = ""
    type_m = re.match(r"^([A-Za-z]+(?:\s+[A-Za-z]+)*?)(?:\s*\(([^)]+)\))?$", raw_type)
    if type_m:
        type_word = type_m.group(1).strip().capitalize()
        subtype = (type_m.group(2) or "").strip()
        if subtype:
            subtype = " ".join(w.capitalize() for w in subtype.split())
    else:
        type_word = raw_type.capitalize()
    alignment_tc = " ".join(w.capitalize() for w in alignment.split())
    return {"size": size, "type": type_word, "subtype": subtype, "alignment": alignment_tc}

def parse_ac(text):
    m = AC_RX.match(text.strip())
    if not m:
        return None
    ac = int(m.group(1))
    notes = (m.group(2) or "").strip()
    acText = f"AC {ac}" + (f" ({notes})" if notes else "")
    return ac, acText

def parse_hp(text):
    m = HP_RX.match(text.strip())
    if not m:
        return None
    if m.group(1):
        return int(m.group(1)), m.group(2).strip()
    return int(m.group(3)), ""

def parse_speed(text):
    """ '10 ft., swim 40 ft., fly 40 ft. (ethereal only, hover)' """
    text = text.strip().rstrip(".")
    speed = {}
    parts = [p.strip() for p in text.split(",")]
    for p in parts:
        mw = re.match(r"^(?:(walk|fly|swim|burrow|climb)\s+)?(\d+)\s*ft\.?(?:\s*\((.*?)\))?", p, re.I)
        if not mw:
            continue
        mode = (mw.group(1) or "walk").lower()
        ft = int(mw.group(2))
        note = (mw.group(3) or "").lower()
        speed[mode] = ft
        if "hover" in note:
            speed["hover"] = True
    return speed, text + "."

def _mod_int(s):
    return int(s.replace("‒","-").replace("−","-").replace("–","-"))

def parse_abilities(header_text, row_text):
    if not ABILITY_HEADER_RX.match(header_text.strip()):
        return None
    m = ABILITY_ROW_RX.match(row_text.strip())
    if not m:
        return None
    out = {}
    keys = ["str","dex","con","int","wis","cha"]
    g = m.groups()
    for i, k in enumerate(keys):
        score = int(g[i*2])
        mod = _mod_int(g[i*2+1])
        out[k] = {"score": score, "mod": mod, "save": mod}
    return out

def parse_saves(text, abilities):
    """ 'Con +6, Int +8, Wis +6' — overlay save bonuses on ability dict. """
    for chunk in text.split(","):
        m = re.match(r"^\s*(Str|Dex|Con|Int|Wis|Cha)\s+([+\-‒−–]\d+)\s*$", chunk)
        if not m:
            continue
        k = m.group(1).lower()
        if k in abilities:
            abilities[k]["save"] = _mod_int(m.group(2))

def parse_skills(text):
    out = {}
    for chunk in text.split(","):
        m = re.match(r"^\s*([A-Za-z][A-Za-z\s']*?)\s+([+\-‒−–]\d+)\s*$", chunk)
        if not m:
            continue
        out[m.group(1).strip()] = _mod_int(m.group(2))
    return out

def split_csv_safe(text):
    """Split on commas not inside parens. Preserves parenthetical content as-is."""
    out, buf, depth = [], [], 0
    for ch in text:
        if ch == "(":
            depth += 1; buf.append(ch)
        elif ch == ")":
            depth = max(0, depth - 1); buf.append(ch)
        elif ch == "," and depth == 0:
            chunk = "".join(buf).strip()
            if chunk: out.append(chunk)
            buf = []
        else:
            buf.append(ch)
    if buf:
        chunk = "".join(buf).strip()
        if chunk: out.append(chunk)
    return out

def titlecase_clause(text):
    """
    Title-case words OUTSIDE parens, preserve parenthetical content verbatim.
    Joiners ("and"/"or"/"of"/"from"/"with"/"in"/"by"/"the") stay lowercase
    except at the start of the clause.

    Re.split with a capturing group preserves the parens AS separate chunks
    but loses the whitespace around them. We re-insert single spaces between
    non-empty chunks so "Thunder (only when in form)" doesn't become
    "Thunder(only when in form)".
    """
    parts = re.split(r"(\([^)]*\))", text)
    rendered = []
    word_idx = 0
    for part in parts:
        if part.startswith("("):
            rendered.append(part)
            continue
        words = part.split()
        if not words:
            rendered.append("")
            continue
        new_words = []
        for w in words:
            wlow = w.lower()
            if word_idx > 0 and wlow in ("and","or","of","from","with","the","in","by","a","an","to"):
                new_words.append(wlow)
            else:
                new_words.append(w[:1].upper() + w[1:].lower() if w else w)
            word_idx += 1
        rendered.append(" ".join(new_words))
    # Re-join the chunks with single spaces between non-empty neighbours so
    # "Thunder" + "(only when in form)" → "Thunder (only when in form)".
    out_pieces = []
    for chunk in rendered:
        if not chunk:
            continue
        if out_pieces:
            out_pieces.append(" ")
        out_pieces.append(chunk)
    return "".join(out_pieces).strip()

def titlecase_list(text):
    """
    'acid, fire, lightning (only when in form); bludgeoning from weapons'
      → 'Acid, Fire, Lightning (only when in form); Bludgeoning from Weapons'
    Splits on ; first (preserves it), then on , (excluding commas inside parens).
    Parenthetical contents are passed through unchanged.
    """
    if not text:
        return ""
    semi_parts = []
    for semi in text.split(";"):
        items = [titlecase_clause(c) for c in split_csv_safe(semi.strip())]
        semi_parts.append(", ".join(items))
    return "; ".join(semi_parts)

def parse_challenge(text):
    m = CR_RX.match(text.strip())
    if not m:
        return None
    raw = m.group(1).replace("¼","1/4").replace("½","1/2")
    if "/" in raw:
        a,b = raw.split("/")
        cr = int(a)/int(b)
    else:
        try: cr = int(raw)
        except: cr = 0
    xp = int(m.group(2).replace(",","")) if m.group(2) else 0
    return cr, raw, xp

def pb_for_cr(cr):
    return (2 if cr <= 4 else 3 if cr <= 8 else 4 if cr <= 12 else 5
            if cr <= 16 else 6 if cr <= 20 else 7 if cr <= 24 else 8 if cr <= 28 else 9)

def parse_senses(text):
    text = text.strip().rstrip(".")
    parts = [p.strip() for p in text.split(",")]
    senses = {}
    titled = []
    for p in parts:
        mw = re.match(r"^(passive Perception|blindsight|darkvision|tremorsense|truesight|telepathy)\s+(\d+)(\s*ft\.?)?", p, re.I)
        if mw:
            key = mw.group(1).lower().replace(" ","")
            val = int(mw.group(2))
            senses[key] = val
            titled.append(f"{mw.group(1)[:1].upper() + mw.group(1)[1:]} {val}{mw.group(3) or ''}")
        else:
            titled.append(p)
    return senses, ", ".join(titled)

def parse_languages(text):
    text = text.strip().rstrip(".")
    return ([c.strip() for c in text.split(",") if c.strip()], text)


# ── 2014 → 2024 action body transform ──────────────────────────────────────

def transform_action_body(body):
    if not body:
        return body
    s = body
    # "Melee/Ranged/Melee or Ranged Weapon Attack: +X to hit, ..."
    s = re.sub(
        r"(Melee or Ranged|Melee|Ranged) Weapon Attack:\s*([+\-‒−–]\d+)\s*to hit,\s*",
        lambda m: f"{m.group(1)} Attack Roll: {m.group(2)}, ",
        s,
    )
    # Drop "one target." / "one creature." / "one target the X can see." etc.
    s = re.sub(
        r",\s*one (?:target|creature|target the [^.,]+? can see|creature the [^.,]+? can see)(?:\s+(?:in reach))?\.\s*Hit:",
        ". Hit:",
        s,
    )
    # Title-case damage types in "Hit: N (NdM ± K) <type> damage" clauses.
    def _ttype(mm):
        n, dice, t = mm.group(1), mm.group(2), mm.group(3)
        return f"{n} ({dice}) {t[:1].upper() + t[1:].lower()} damage"
    s = re.sub(
        r"(\d+)\s*\(\s*(\d+d\d+(?:\s*[+\-‒−–]\s*\d+)?)\s*\)\s+([A-Za-z]+)\s+damage",
        _ttype, s
    )
    # Title-case condition names like "the frightened condition".
    def _tcond(mm):
        return f"the {mm.group(1)[:1].upper() + mm.group(1)[1:].lower()} condition"
    s = re.sub(r"\bthe ([a-z]+) condition\b", _tcond, s)
    # Normalize unicode minus.
    s = s.replace("‒","-").replace("−","-").replace("–","-")
    # Trim "5 ft.." double-period that occasionally creeps in.
    s = re.sub(r"(\bft\.)\.+", r"\1", s)
    return s


# ── Top-level extraction ───────────────────────────────────────────────────

def pascal_id(name):
    cleaned = re.sub(r"[^A-Za-z0-9]+", " ", name).strip()
    return "".join(w.capitalize() for w in cleaned.split())

def extract_monster(stream, page_for_line, anchor, next_anchor_nameIdx):
    """
    Parse one stat block. Returns the monster dict, or None if it doesn't
    produce a usable shape (missing core fields).
    """
    st = parse_size_type(stream[anchor["sizeTypeIdx"]])
    if not st:
        return None
    name = stream[anchor["nameIdx"]].strip()
    name_clean = " ".join(w[:1].upper() + w[1:].lower() if w.isupper() else w
                          for w in name.split())
    out = {
        "source": SOURCE_TAG,
        "sourcePage": page_for_line[anchor["acIdx"]] if anchor["acIdx"] < len(page_for_line) else None,
        "id": pascal_id(name_clean) + "StatBlock",
        "name": name_clean,
        "group": name_clean.split(",")[0].strip(),
        "size": st["size"],
        "type": st["type"],
        "subtype": st["subtype"],
        "alignment": st["alignment"],
        "ac": None, "acText": "",
        "initiative": None, "initiativeScore": None,
        "hp": None, "hpFormula": "",
        "speed": {}, "speedText": "",
        "abilities": {},
        "traits": [], "actions": [], "bonusActions": [],
        "reactions": [], "legendaryActions": [], "lairActions": [], "lairEffects": [],
        "skills": {},
        "senses": {}, "sensesText": "",
        "languages": [], "languagesText": "",
        "resistancesText": "",
        "immunitiesText": "",
        "vulnerabilitiesText": "",
        "crText": "0", "cr": 0, "xp": 0, "pb": 2,
        "description": "",
    }
    stop = next_anchor_nameIdx if next_anchor_nameIdx is not None else len(stream)
    fields, post_idx = gather_fields(stream, anchor["acIdx"], stop)

    if "Armor Class" in fields:
        ac = parse_ac(fields["Armor Class"])
        if ac:
            out["ac"], out["acText"] = ac
    if "Hit Points" in fields:
        hp = parse_hp(fields["Hit Points"])
        if hp:
            out["hp"], out["hpFormula"] = hp
    if "Speed" in fields:
        sp = parse_speed(fields["Speed"])
        if sp:
            out["speed"], out["speedText"] = sp
    if "STR DEX CON INT WIS CHA" in fields and "_ability_row" in fields:
        # Stash the row value during gathering — we read the next line under
        # this label as the row.
        pass
    # Ability row is collected as the value of the label "STR DEX CON INT WIS CHA"
    # because the row sits immediately under the header in the column flow.
    if "STR DEX CON INT WIS CHA" in fields:
        row = fields["STR DEX CON INT WIS CHA"]
        abil = parse_abilities("STR DEX CON INT WIS CHA", row)
        if abil:
            out["abilities"] = abil
            # Initiative = Dex mod; initiative score = 10 + mod (2024 convention).
            d = abil.get("dex", {}).get("mod", 0)
            out["initiative"] = d
            out["initiativeScore"] = 10 + d
    if "Saving Throws" in fields and out["abilities"]:
        parse_saves(fields["Saving Throws"], out["abilities"])
    if "Skills" in fields:
        out["skills"] = parse_skills(fields["Skills"])
    if "Damage Vulnerabilities" in fields:
        out["vulnerabilitiesText"] = titlecase_list(fields["Damage Vulnerabilities"])
    if "Damage Resistances" in fields:
        out["resistancesText"] = titlecase_list(fields["Damage Resistances"])
    if "Damage Immunities" in fields:
        out["immunitiesText"] = titlecase_list(fields["Damage Immunities"])
    if "Condition Immunities" in fields:
        ci = titlecase_list(fields["Condition Immunities"])
        out["immunitiesText"] = (out["immunitiesText"] + "; " + ci) if out["immunitiesText"] else ci
    if "Senses" in fields:
        out["senses"], out["sensesText"] = parse_senses(fields["Senses"])
    if "Languages" in fields:
        out["languages"], out["languagesText"] = parse_languages(fields["Languages"])
    if "Challenge" in fields:
        ch = parse_challenge(fields["Challenge"])
        if ch:
            out["cr"], out["crText"], out["xp"] = ch
            out["pb"] = pb_for_cr(out["cr"])

    parse_features(stream, post_idx, stop, out)
    return out


def extract_all(pdf_path):
    print("  Building line stream…")
    stream, page_for_line = build_stream(pdf_path)
    print(f"  Stream: {len(stream)} lines across {page_for_line[-1] - page_for_line[0] + 1} pages")
    anchors = find_anchors(stream)
    print(f"  Anchors found: {len(anchors)}")
    monsters = []
    for k, anc in enumerate(anchors):
        next_idx = anchors[k+1]["nameIdx"] if k+1 < len(anchors) else None
        mon = extract_monster(stream, page_for_line, anc, next_idx)
        if mon and mon["ac"] is not None and mon["hp"] is not None:
            monsters.append(mon)
    return monsters


def main():
    here = Path(__file__).resolve().parent.parent
    in_path = Path(sys.argv[1]) if len(sys.argv) > 1 else here / DEFAULT_PDF
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else here / DEFAULT_OUT
    if not in_path.exists():
        print(f"input PDF not found: {in_path}", file=sys.stderr); return 1
    print(f"Reading {in_path.name} (this takes a minute)…")
    monsters = extract_all(in_path)
    out = {
        "source": SOURCE_TAG,
        "scrapedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(monsters),
        "monsters": monsters,
    }
    out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out_path} — {len(monsters)} monsters")
    from collections import Counter
    types = Counter(m["type"] for m in monsters)
    crs = Counter(m["crText"] for m in monsters)
    print(f"  types: {dict(types.most_common(8))}")
    print(f"  CR top: {dict(crs.most_common(8))}")
    print(f"  with traits:   {sum(1 for m in monsters if m['traits'])}")
    print(f"  with actions:  {sum(1 for m in monsters if m['actions'])}")
    print(f"  with legendary:{sum(1 for m in monsters if m['legendaryActions'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
