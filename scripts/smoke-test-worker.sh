#!/usr/bin/env bash
# Smoke tests for the player-content worker update (H2).
# Run AFTER pasting cloudflare-worker.js into the Cloudflare dashboard.
#
# Usage:
#   DM_USER=you DM_PASS=secret CHAR=character-id CODE=ABC123 \
#     bash scripts/smoke-test-worker.sh
#
# CHAR/CODE: any existing character + its claim code (Atlas → Players tab).
set -u
W="${WORKER_URL:-https://dnd-perk-webhook.jacobgiff.workers.dev}"
pass=0; fail=0
check() { # label expected_fragment actual
  if [[ "$3" == *"$2"* ]]; then echo "✓ $1"; pass=$((pass+1));
  else echo "✗ $1"; echo "    expected fragment: $2"; echo "    got: ${3:0:300}"; fail=$((fail+1)); fi
}

echo "── DM reads (expect empty stores on first run) ──"
check "GET character_sheets (DM)" '[' "$(curl -s "$W/?type=character_sheets" -H "X-DM-User: $DM_USER" -H "X-DM-Pass: $DM_PASS")"
check "GET rules (DM)"            '[' "$(curl -s "$W/?type=rules" -H "X-DM-User: $DM_USER" -H "X-DM-Pass: $DM_PASS")"
check "GET player_notes_dm (DM)"  '{' "$(curl -s "$W/?type=player_notes_dm" -H "X-DM-User: $DM_USER" -H "X-DM-Pass: $DM_PASS")"
check "GET character_sheets w/o auth -> 401" 'DM auth required' "$(curl -s "$W/?type=character_sheets")"

echo "── Aggregate home_view ──"
HV=$(curl -s "$W/?type=home_view&characterId=$CHAR&code=$CODE")
check "home_view has character" '"character"' "$HV"
check "home_view has map"       '"map"'       "$HV"
check "home_view has notes"     '"notes"'     "$HV"
check "home_view has rules"     '"rules"'     "$HV"
check "home_view has sheet"     '"sheet"'     "$HV"
check "home_view has brew"      '"brew"'      "$HV"
check "home_view bad code -> 401" 'invalid character or code' "$(curl -s "$W/?type=home_view&characterId=$CHAR&code=WRONG")"

echo "── Player note round-trip ──"
N=$(curl -s -X POST "$W/" -H 'Content-Type: application/json' \
  -d "{\"type\":\"player_note\",\"characterId\":\"$CHAR\",\"code\":\"$CODE\",\"entityType\":\"general\",\"title\":\"smoke\",\"body\":\"hello from smoke test\"}")
check "player_note create" '"ok":true' "$N"
NOTE_ID=$(echo "$N" | python3 -c "import json,sys; print(json.load(sys.stdin)['note']['id'])" 2>/dev/null)
check "player_notes lists it" 'hello from smoke test' "$(curl -s "$W/?type=player_notes&characterId=$CHAR&code=$CODE")"
check "player_note empty body -> 400" 'note body required' "$(curl -s -X POST "$W/" -H 'Content-Type: application/json' \
  -d "{\"type\":\"player_note\",\"characterId\":\"$CHAR\",\"code\":\"$CODE\",\"entityType\":\"general\",\"body\":\"  \"}")"
check "player_note_delete" '"ok":true' "$(curl -s -X POST "$W/" -H 'Content-Type: application/json' \
  -d "{\"type\":\"player_note_delete\",\"characterId\":\"$CHAR\",\"code\":\"$CODE\",\"noteId\":\"$NOTE_ID\"}")"

echo "── Sheet round-trip ──"
S=$(curl -s -X POST "$W/" -H 'Content-Type: application/json' -H "X-DM-User: $DM_USER" -H "X-DM-Pass: $DM_PASS" \
  -d "{\"type\":\"character_sheets\",\"payload\":[{\"id\":\"$CHAR\",\"characterId\":\"$CHAR\",\"sections\":[{\"id\":\"sec_pub\",\"heading\":\"Notes\",\"fields\":[],\"body\":\"\",\"playerEditable\":true,\"dmOnly\":false},{\"id\":\"sec_dm\",\"heading\":\"Secrets\",\"fields\":[],\"body\":\"dm eyes only\",\"playerEditable\":false,\"dmOnly\":true},{\"id\":\"sec_ro\",\"heading\":\"Background\",\"fields\":[],\"body\":\"canon\",\"playerEditable\":false,\"dmOnly\":false}]}]}")
check "DM writes sheet" '"ok":true' "$S"
SV=$(curl -s "$W/?type=sheet_view&characterId=$CHAR&code=$CODE")
check "sheet_view returns sheet"       'sec_pub' "$SV"
check "sheet_view strips dmOnly"       '' "$(echo "$SV" | grep -c sec_dm | sed 's/^0$//')"
check "sheet_update editable section"  '"ok":true' "$(curl -s -X POST "$W/" -H 'Content-Type: application/json' \
  -d "{\"type\":\"sheet_update\",\"characterId\":\"$CHAR\",\"code\":\"$CODE\",\"sectionId\":\"sec_pub\",\"body\":\"player wrote this\"}")"
check "sheet_update read-only -> 403"  'not player-editable' "$(curl -s -X POST "$W/" -H 'Content-Type: application/json' \
  -d "{\"type\":\"sheet_update\",\"characterId\":\"$CHAR\",\"code\":\"$CODE\",\"sectionId\":\"sec_ro\",\"body\":\"hax\"}")"
check "sheet_update dmOnly -> 403"     'not player-editable' "$(curl -s -X POST "$W/" -H 'Content-Type: application/json' \
  -d "{\"type\":\"sheet_update\",\"characterId\":\"$CHAR\",\"code\":\"$CODE\",\"sectionId\":\"sec_dm\",\"body\":\"hax\"}")"

echo "── Rules visibility ──"
R=$(curl -s -X POST "$W/" -H 'Content-Type: application/json' -H "X-DM-User: $DM_USER" -H "X-DM-Pass: $DM_PASS" \
  -d "{\"type\":\"rules\",\"payload\":[{\"id\":\"r1\",\"title\":\"Open rule\",\"body\":\"for everyone\",\"order\":1,\"visibleTo\":[]},{\"id\":\"r2\",\"title\":\"Gated rule\",\"body\":\"not for you\",\"order\":2,\"visibleTo\":[\"someone-else\"]}]}")
check "DM writes rules" '"ok":true' "$R"
RV=$(curl -s "$W/?type=rules_view&characterId=$CHAR&code=$CODE")
check "rules_view shows open rule"   'Open rule' "$RV"
check "rules_view hides gated rule"  '' "$(echo "$RV" | grep -c 'Gated rule' | sed 's/^0$//')"

echo "── Whisper read-state ──"
check "journals_read" '"ok":true' "$(curl -s -X POST "$W/" -H 'Content-Type: application/json' \
  -d "{\"type\":\"journals_read\",\"characterId\":\"$CHAR\",\"code\":\"$CODE\",\"journalIds\":[\"nonexistent\"]}")"

echo
echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
