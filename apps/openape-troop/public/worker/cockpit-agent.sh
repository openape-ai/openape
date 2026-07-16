#!/usr/bin/env bash
# Reactive service-agent helper. Auth = this Mac's apes DDISA identity.
# Auto-auth: send the raw apes token; on 401 exchange it for an SP-scoped token
# (cached per-target, 30-day) and retry. Each target gets its own token cache.
#
# Target selection:
#   default            -> troop Cockpit ($Operator_SP_URL, /api/cockpit/agent/tasks)
#   SVC_URL + SVC_TASKS -> any registered sp-tasks service (e.g. zaz.delta-mind.at)
#
# Commands:
#   cockpit-agent.sh services                       # list registered services (from troop)
#   cockpit-agent.sh heartbeat [nextPollInMs]       # check-in; arg = when you'll next poll (default 12s)
#   cockpit-agent.sh next                           # lease next task on the target
#   cockpit-agent.sh memory <id>                     # fetch a reference Memory doc (prints body)
#   cockpit-agent.sh skill <id>                      # fetch a Skill's procedure (prints prompt)
#   cockpit-agent.sh progress <id> "🧠 …"           # working update
#   cockpit-agent.sh resolve  <id> completed <<<'…' # resolve (stdin = answer)
# Dev: Operator_SP_URL=http://localhost:3010
set -euo pipefail
TROOP="${Operator_SP_URL:-https://troop.openape.ai}"
SP="${SVC_URL:-$TROOP}"
TP="${SVC_TASKS:-/api/cockpit/agent/tasks}"
AUTH_JSON="$HOME/.config/apes/auth.json"
CACHE="/tmp/cockpit-sp-$(printf '%s' "$SP" | shasum | cut -c1-12).tok"

idp() { AUTH_JSON="$AUTH_JSON" python3 -c 'import json,os;print(json.load(open(os.environ["AUTH_JSON"]))["access_token"])'; }
mint() { # exchange raw apes token -> SP-scoped token, cache it
  local t
  t=$(curl -sS --max-time 15 -X POST "$SP/api/cli/exchange" -H 'content-type: application/json' \
        -d "$(IDP="$(idp)" python3 -c 'import json,os;print(json.dumps({"subject_token":os.environ["IDP"]}))')" \
      | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')
  [ -n "$t" ] || { echo "exchange failed at $SP (apes login?)" >&2; exit 3; }
  printf '%s' "$t" > "$CACHE"; printf '%s' "$t"
}
authtok() { [ -s "$CACHE" ] && cat "$CACHE" || idp; }  # cached SP token, else raw apes token
call() { # method path [body] -> echoes body; raw-token first, 401 -> exchange+retry
  local m="$1" p="$2" b="${3:-}" code out
  out=$(curl -sS --max-time 30 -w $'\n%{http_code}' -X "$m" "$SP$p" -H "authorization: Bearer $(authtok)" -H 'content-type: application/json' ${b:+-d "$b"})
  code="${out##*$'\n'}"; out="${out%$'\n'*}"
  if [ "$code" = "401" ]; then rm -f "$CACHE"; out=$(curl -sS --max-time 30 -X "$m" "$SP$p" -H "authorization: Bearer $(mint)" -H 'content-type: application/json' ${b:+-d "$b"}); fi
  printf '%s' "$out"
}
resolve_body() { TASK_ID="$1" STATE="$2" TEXT="$3" python3 -c 'import json,os;print(json.dumps({"id":os.environ["TASK_ID"],"state":os.environ["STATE"],"artifact":{"parts":[{"kind":"text","text":os.environ["TEXT"]}]}}))'; }

CMD="${1:?usage: cockpit-agent.sh services|heartbeat|next|progress <id> <text>|resolve <id> <state>}"; shift || true
case "$CMD" in
  services) # always troop; prints: SVC_URL<TAB>SVC_TASKS<TAB>label  (enabled only)
    SP="$TROOP" TP="/api/cockpit" CACHE="/tmp/cockpit-sp-$(printf '%s' "$TROOP" | shasum | cut -c1-12).tok" \
      call GET /api/cockpit/services | python3 -c 'import sys,json
for s in json.load(sys.stdin):
    if s.get("enabled"): print("%s\t%s\t%s"%(s["baseUrl"],s.get("tasksPath","/api/agent/tasks"),s.get("label","")))' ;;
  heartbeat) # always troop; optional arg = nextPollInMs (how soon you'll next check in).
    # Default ~12s = actively bursting. Pass your wake delay (e.g. 60000) right before
    # you end a turn so the cockpit shows "Ruhemodus · <countdown>" instead of guessing.
    SP="$TROOP" CACHE="/tmp/cockpit-sp-$(printf '%s' "$TROOP" | shasum | cut -c1-12).tok" \
      call POST /api/cockpit/agent/heartbeat "$(printf '{"nextPollInMs":%s}' "${1:-12000}")" ;;
  next)      call POST "$TP/next" ;;
  memory)    # always troop; prints the doc body for the Operator to read
    ID="${1:?usage: cockpit-agent.sh memory <id>}"
    SP="$TROOP" CACHE="/tmp/cockpit-sp-$(printf '%s' "$TROOP" | shasum | cut -c1-12).tok" \
      call GET "/api/cockpit/agent/memory/$ID" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("body",""))' ;;
  skill)     # always troop; prints the skill's procedure for the agent to follow
    ID="${1:?usage: cockpit-agent.sh skill <id>}"
    SP="$TROOP" CACHE="/tmp/cockpit-sp-$(printf '%s' "$TROOP" | shasum | cut -c1-12).tok" \
      call GET "/api/cockpit/agent/skill/$ID" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("prompt",""))' ;;
  progress)  ID="$1"; shift; call POST "$TP/resolve" "$(resolve_body "$ID" working "$*")" ;;
  resolve)   ID="$1"; STATE="$2"; call POST "$TP/resolve" "$(resolve_body "$ID" "$STATE" "$(cat)")" ;;
  *) echo "usage: cockpit-agent.sh services|heartbeat|next|memory <id>|skill <id>|progress <id> <text>|resolve <id> <completed|failed>" >&2; exit 2 ;;
esac
