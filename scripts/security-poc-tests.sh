#!/usr/bin/env bash
# Security PoC tests for Panel Envanter (run with app at BASE_URL)
# Usage: BASE_URL=http://localhost:3000 bash scripts/security-poc-tests.sh

set -e
BASE="${BASE_URL:-http://localhost:3000}"

echo "=== Test 1: Security headers ==="
curl -sI "$BASE/" | grep -iE 'x-content-type|content-security|x-frame' || true

echo ""
echo "=== Test 2: Rate limiting (6th = 429) ==="
for i in $(seq 1 6); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/login" \
    -H "Content-Type: application/json" \
    -d '{"user":"admin","pass":"x"}')
  echo "  Request $i: $CODE"
  if [ "$CODE" = "429" ]; then
    echo "  >>> 429 seen as expected."
    break
  fi
done

echo ""
echo "=== Test 3a: Invalid login body (400) ==="
curl -s -w "\n  HTTP: %{http_code}\n" -X POST "$BASE/api/login" \
  -H "Content-Type: application/json" \
  -d '{"panel_count":-100}'

echo ""
echo "=== Test 4: SQL injection attempt (401, no 500) ==="
curl -s -w "\n  HTTP: %{http_code}\n" -X POST "$BASE/api/login" \
  -H "Content-Type: application/json" \
  -d '{"user":"'"'"' OR '"'"'1'"'"'='"'"'1","pass":"x"}'

echo ""
echo "=== Done ==="
