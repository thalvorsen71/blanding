#!/bin/bash
# Batch re-audit all schools on the leaderboard.
# Usage: ./scripts/batch-reaudit.sh
#
# Fetches the leaderboard, then re-audits each school one at a time
# with a delay between calls to respect API rate limits.
#
# Results are logged to scripts/reaudit-log.json

ENDPOINT="https://blandingaudit.netlify.app/.netlify/functions/reaudit"
SECRET="blanding2026"
DELAY=15  # seconds between schools (prevent blob write race conditions + API rate limits)
LOG="scripts/reaudit-log.json"

echo "Fetching current leaderboard..."
SCHOOLS=$(curl -s "https://blandingaudit.netlify.app/.netlify/functions/leaderboard" \
  | python3 -c "
import json, sys
data = json.loads(sys.stdin.read())
schools = data.get('schools', [])
for s in schools:
    url = s.get('url', '')
    if url:
        print(url)
")

TOTAL=$(echo "$SCHOOLS" | wc -l | tr -d ' ')
echo "Found $TOTAL schools to re-audit"
echo "Estimated time: ~$((TOTAL * DELAY / 60)) minutes"
echo ""

START_AT=${1:-1}  # Optional: pass starting school number as argument
echo "Starting from school #$START_AT"

echo "[]" > "$LOG"
COUNT=0
SUCCEEDED=0
FAILED=0

for school in $SCHOOLS; do
  COUNT=$((COUNT + 1))

  # Skip schools before START_AT
  if [ $COUNT -lt $START_AT ]; then continue; fi

  echo -n "[$COUNT/$TOTAL] $school ... "

  RESULT=$(curl -s -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -d "{\"secret\":\"$SECRET\",\"url\":\"https://$school\"}" \
    --max-time 60)

  SUCCESS=$(echo "$RESULT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('success',''))" 2>/dev/null)
  SCORE=$(echo "$RESULT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('score','?'))" 2>/dev/null)
  OLD=$(echo "$RESULT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('oldScore','?'))" 2>/dev/null)
  ERR=$(echo "$RESULT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('error',''))" 2>/dev/null)

  if [ "$SUCCESS" = "True" ]; then
    SUCCEEDED=$((SUCCEEDED + 1))
    DELTA=""
    if [ "$OLD" != "None" ] && [ "$OLD" != "?" ]; then
      DIFF=$((SCORE - OLD))
      if [ $DIFF -gt 0 ]; then DELTA=" (+$DIFF)"; elif [ $DIFF -lt 0 ]; then DELTA=" ($DIFF)"; fi
    fi
    echo "score=$SCORE (was $OLD)$DELTA"
  else
    FAILED=$((FAILED + 1))
    echo "FAILED: $ERR"
  fi

  # Append to log
  python3 -c "
import json
with open('$LOG', 'r') as f: log = json.load(f)
log.append(json.loads('''$RESULT'''))
with open('$LOG', 'w') as f: json.dump(log, f, indent=2)
" 2>/dev/null

  # Rate limit delay (skip on last)
  if [ $COUNT -lt $TOTAL ]; then
    sleep $DELAY
  fi
done

echo ""
echo "=== BATCH RE-AUDIT COMPLETE ==="
echo "Total: $TOTAL | Succeeded: $SUCCEEDED | Failed: $FAILED"
echo "Log: $LOG"
