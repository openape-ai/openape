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
resolve_body() { TASK_ID="$1" STATE="$2" TEXT="$3" RETRY_IN_MS="${4:-}" FILE_IDS="${5:-}" python3 -c 'import json,os
parts=[{"kind":"text","text":os.environ["TEXT"]}]
parts+= [{"kind":"file","fileId":f} for f in os.environ["FILE_IDS"].split() if f]
body={"id":os.environ["TASK_ID"],"state":os.environ["STATE"],"artifact":{"parts":parts}}
retry=os.environ["RETRY_IN_MS"]
body.update({"retryInMs": int(retry)} if retry else {})
print(json.dumps(body))'; }

CMD="${1:?usage: cockpit-agent.sh services|heartbeat|doctor|next|ask <id> <frage> [opt…]|progress <id> <text>|resolve <id> <state> [retryInMs]}"; shift || true
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
  doctor) # always troop; resolve every declared CLI in THIS process's env and
    # report cli→found with a heartbeat. Catches PATH drift between the owner's
    # login shell and the worker (launchd) before any task fails on exit 127.
    SP="$TROOP" CACHE="/tmp/cockpit-sp-$(printf '%s' "$TROOP" | shasum | cut -c1-12).tok"
    CLIS=$(call GET /api/cockpit/agent/doctor | python3 -c 'import sys,json;print("\n".join(json.load(sys.stdin).get("clis",[])))')
    REPORT=$(while IFS= read -r c; do
      [ -z "$c" ] && continue
      if command -v "$c" >/dev/null 2>&1; then echo "$c true"; else echo "$c false"; fi
    done <<< "$CLIS" | python3 -c 'import sys,json;print(json.dumps({w[0]:w[1]=="true" for l in sys.stdin if (w:=l.split())}))')
    SP="$TROOP" CACHE="/tmp/cockpit-sp-$(printf '%s' "$TROOP" | shasum | cut -c1-12).tok" \
      call POST /api/cockpit/agent/heartbeat "$(printf '{"nextPollInMs":%s,"doctor":%s}' "${1:-12000}" "$REPORT")"
    echo "$REPORT" ;;
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
  resolve)   # resolve <id> <state> [retryInMs] [--file <id>]...  (stdin = Antworttext)
    ID="$1"; STATE="$2"; shift 2; RETRY_IN_MS=""; FILE_IDS=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --file) FILE_IDS="$FILE_IDS $2"; shift 2 ;;
        *) RETRY_IN_MS="$1"; shift ;;
      esac
    done
    call POST "$TP/resolve" "$(resolve_body "$ID" "$STATE" "$(cat)" "$RETRY_IN_MS" "$FILE_IDS")" ;;
  file) # download an attachment to a path: file <id> <outpath>
    ID="${1:?usage: cockpit-agent.sh file <id> <outpath>}"; OUT="${2:?usage: cockpit-agent.sh file <id> <outpath>}"
    curl -sS --max-time 60 -o "$OUT" -H "authorization: Bearer $(authtok)" "$SP/api/cockpit/agent/files/$ID" || exit 4
    # 401 → token stale: mint + retry once (call() buffers bodies, files stream to disk)
    if head -c 20 "$OUT" | grep -q '"status":401' 2>/dev/null; then
      curl -sS --max-time 60 -o "$OUT" -H "authorization: Bearer $(mint)" "$SP/api/cockpit/agent/files/$ID"
    fi ;;
  upload) # upload a file, print its id: upload <pfad> [name]
    P="${1:?usage: cockpit-agent.sh upload <pfad> [name]}"; N="${2:-$(basename "$P")}"
    MIME=$(file --mime-type -b "$P" 2>/dev/null || echo application/octet-stream)
    OUT=$(curl -sS --max-time 60 -X POST "$SP/api/cockpit/agent/files" -H "authorization: Bearer $(authtok)" -F "file=@$P;type=$MIME;filename=$N")
    if printf '%s' "$OUT" | grep -q '"status":401'; then
      OUT=$(curl -sS --max-time 60 -X POST "$SP/api/cockpit/agent/files" -H "authorization: Bearer $(mint)" -F "file=@$P;type=$MIME;filename=$N")
    fi
    printf '%s' "$OUT" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("id") or sys.exit(4))' ;;
  ask) # pause the task on an owner question: ask <id> "Frage" [opt1] [opt2] [opt3] [opt4]
    ID="${1:?usage: cockpit-agent.sh ask <id> <frage> [optionen...]}"; shift
    Q="${1:?usage: cockpit-agent.sh ask <id> <frage> [optionen...]}"; shift
    BODY=$(TASK_ID="$ID" QUESTION="$Q" python3 -c 'import json,os,sys
opts=[o for o in sys.argv[1:] if o.strip()]
print(json.dumps({"id":os.environ["TASK_ID"],"state":"input-required","question":os.environ["QUESTION"],"options":opts}))' "$@")
    call POST "$TP/resolve" "$BODY" ;;
  automation) call POST /api/cockpit/agent/automations "$(cat)" ;; # Operator self-scheduling: JSON action body on stdin
  *) echo "usage: cockpit-agent.sh services|heartbeat|next|memory <id>|skill <id>|progress <id> <text>|resolve <id> <completed|failed|deferred> [retryInMs]|ask <id> <frage> [opt…]|automation (json on stdin)" >&2; exit 2 ;;
esac
