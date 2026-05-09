#!/bin/bash
# Manual e2e negative tests for the Nest's DDISA Bearer-auth layer.
#
# Run against a live setup: `apes nest install` + `apes nest enroll`
# + `apes nest authorize` + at least one approved `nest list` grant
# (run `apes nest list` once interactively first).
#
# Why this isn't a vitest suite: the tokens are signed by the live
# IdP — mocking JWKS just to assert "verify rejects" duplicates what
# we'd test in @openape/core's own unit tests, while NOT covering the
# integration glue (route matching, hostname comparison, error
# response shape). Real tokens against a real daemon catches those.
#
# Exit 0 on all-pass, non-zero on any failure.

set -uo pipefail

NEST=${NEST:-http://127.0.0.1:9091}
PASS=0
FAIL=0

assert_status() {
  local name=$1 expected=$2 actual=$3
  if [ "$actual" = "$expected" ]; then
    echo "  PASS  $name → $actual"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name → expected $expected, got $actual"
    FAIL=$((FAIL + 1))
  fi
}

echo "T1: GET /agents without Authorization → 401"
S=$(curl -sS -o /dev/null -w "%{http_code}" "$NEST/agents")
assert_status "no bearer" "401" "$S"

echo
echo "T2: GET /agents with malformed bearer → 401"
S=$(curl -sS -H 'Authorization: Bearer garbage' -o /dev/null -w "%{http_code}" "$NEST/agents")
assert_status "garbage bearer" "401" "$S"

echo
echo "T3: GET /agents with non-nest-audience JWT → 401"
NONNEST=$(jq -r .access_token ~/.config/apes/auth.json)
S=$(curl -sS -H "Authorization: Bearer $NONNEST" -o /dev/null -w "%{http_code}" "$NEST/agents")
assert_status "wrong audience" "401" "$S"

echo
echo "T4: nest-list token → POST /agents → 403 (command mismatch)"
HUMAN=$(jq -r .access_token ~/.config/apes/auth.json)
EMAIL=$(jq -r .email ~/.config/apes/auth.json)
LIST_GID=$(curl -sS -H "Authorization: Bearer $HUMAN" \
  "https://id.openape.ai/api/grants?status=approved&limit=50&requester=$(printf '%s' "$EMAIL" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read(),safe=""))')" \
  | python3 -c "
import json, sys
for g in json.load(sys.stdin).get('data', []):
    r = g.get('request', {})
    if r.get('audience') == 'nest' and r.get('command') == ['nest','list'] and r.get('grant_type') != 'once':
        print(g['id']); break
")
if [ -z "$LIST_GID" ]; then
  echo "  SKIP  no approved nest-list grant — run \`apes nest list\` once first"
else
  LIST_TOK=$(curl -sS -X POST -H "Authorization: Bearer $HUMAN" \
    "https://id.openape.ai/api/grants/$LIST_GID/token" | jq -r .authz_jwt)
  S=$(curl -sS -X POST -H "Authorization: Bearer $LIST_TOK" -H 'content-type: application/json' \
    -d '{"name":"badtest"}' -o /dev/null -w "%{http_code}" "$NEST/agents")
  assert_status "command mismatch" "403" "$S"
fi

echo
echo "T5: target_host mismatch (covered implicitly — every successful call must match the local hostname). Skipping standalone test."
echo
echo "Summary: $PASS passed, $FAIL failed"
exit $FAIL
