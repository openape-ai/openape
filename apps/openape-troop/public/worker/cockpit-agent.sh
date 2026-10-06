#!/usr/bin/env bash
# Reactive service-agent helper.
#
# Auth (#1033, Drei-Stufen-Modell):
#   troop-Cockpit  -> DELEGIERTE Operator-Identität (operator.env): ed25519
#                     client_assertion -> IdP /token (delegation_grant) ->
#                     troop /api/cli/exchange -> 15-min-Token mit
#                     troop:cockpit-serve. Fällt bei jedem Fehler auf den
#                     Owner-Pfad zurück (Log-Zeile), damit der Loop nie stirbt.
#   Services (zaz…) -> weiterhin Owner-Identität (raw apes token; die
#                     Delegation gilt nur für die troop-Audience — pro-Service-
#                     Delegationen sind der Folgeschritt, siehe Issue #1031/#1033).
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

# Delegierte Operator-Assertion vom IdP holen (leer bei jedem Fehler → Fallback).
# Pure node:crypto — kein jose nötig: EdDSA-JWT von Hand bauen und signieren.
# set -a: die Variablen müssen EXPORTIERT sein — der node-Kindprozess in
# op_assertion liest sie aus process.env.
[ -f "$HOME/.config/openape-worker/operator.env" ] && { set -a; . "$HOME/.config/openape-worker/operator.env"; set +a; }
GRANTS_MAP="$HOME/.config/openape-worker/operator-grants.json"

# Grant-Id für eine Audience: troop aus operator.env, Services aus der Map,
# die `ensure-delegations` pflegt.
op_grant_for() { # $1 = audience host
  if [ "$1" = "troop.openape.ai" ]; then printf '%s' "${OPERATOR_GRANT:-}"; return; fi
  [ -f "$GRANTS_MAP" ] || return 0
  GRANTS_MAP="$GRANTS_MAP" AUD="$1" python3 -c 'import json,os;print(json.load(open(os.environ["GRANTS_MAP"])).get(os.environ["AUD"],""))' 2>/dev/null || true
}

op_assertion() { # $1 = audience host (default troop)
  [ -n "${OPERATOR_KEY:-}" ] && [ -f "$OPERATOR_KEY" ] || return 0
  local aud="${1:-troop.openape.ai}" grant
  grant=$(op_grant_for "$aud"); [ -n "$grant" ] || return 0
  OP_AUD="$aud" OP_GRANT="$grant" node - <<'NODEOF' || true
const { createPrivateKey, sign, randomUUID } = require('node:crypto')
const { readFileSync } = require('node:fs')
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const env = process.env
const key = createPrivateKey(readFileSync(env.OPERATOR_KEY))
const now = Math.floor(Date.now() / 1000)
const h = b64({ alg: 'EdDSA', typ: 'JWT' })
const p = b64({ iss: env.OPERATOR_EMAIL, sub: env.OPERATOR_EMAIL, aud: `${env.OPERATOR_IDP}/token`, jti: randomUUID(), iat: now, exp: now + 300 })
const jwt = `${h}.${p}.` + sign(null, Buffer.from(`${h}.${p}`), key).toString('base64url')
fetch(`${env.OPERATOR_IDP}/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
  grant_type: 'client_credentials',
  client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
  client_assertion: jwt,
  delegation_grant: env.OP_GRANT,
  audience: env.OP_AUD,
}) }).then(async (r) => {
  if (!r.ok) { console.error(`[op] /token HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`); process.exit(1) }
  const d = await r.json(); process.stdout.write(d.access_token || '')
}).catch((e) => { console.error('[op] fetch failed:', e?.cause?.code ?? e?.message ?? e); process.exit(1) })
NODEOF
}

# Darf diese Audience den Operator-Pfad nutzen? troop immer; Services nur per
# Opt-in (OPERATOR_SERVICE_AUDIENCES in operator.env, space-separiert) — ein SP
# mit ALTEM nuxt-auth-sp-Modul (<0.15) würde ein delegiertes act-Objekt noch zu
# 'human' hochstufen (#1034). Erst nach dessen Modul-Upgrade freischalten.
op_enabled_for() { # $1 = audience host
  [ "$1" = "troop.openape.ai" ] && return 0
  case " ${OPERATOR_SERVICE_AUDIENCES:-} " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

mint() { # SP-Token minten: Operator-Delegation wo freigeschaltet, sonst/Fallback Owner
  local t subj="" aud
  aud=$(printf '%s' "$SP" | sed -E 's|https?://||; s|/.*$||')
  if op_enabled_for "$aud"; then
    subj=$(op_assertion "$aud" || true)
    [ -n "$subj" ] || echo "[auth] operator assertion failed ($aud) — falling back to owner token" >&2
  fi
  # sp-tasks-Services (zaz & Co.) verifizieren den IdP-JWT direkt gegen die JWKS
  # (eigene resolveServiceAgent-Allowlist auf `sub`) — ein SP-Exchange-Token (HS256)
  # würde dort IMMER abgelehnt. Für Services also NIE exchangen: der Bearer ist die
  # delegierte Assertion (Operator) oder der rohe Owner-Token (Fallback). Die
  # 5-min-Assertion re-mintet über den bestehenden 401-Pfad in call().
  if [ "$SP" != "$TROOP" ]; then
    [ -n "$subj" ] || subj=$(idp)
    printf '%s' "$subj" > "$CACHE"; printf '%s' "$subj"; return
  fi
  [ -n "$subj" ] || subj=$(idp)
  t=$(curl -sS --max-time 15 -X POST "$SP/api/cli/exchange" -H 'content-type: application/json' \
        -d "$(SUBJ="$subj" python3 -c 'import json,os;print(json.dumps({"subject_token":os.environ["SUBJ"]}))')" \
      | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')
  if [ -z "$t" ] && [ "$SP" = "$TROOP" ] && [ -n "${OPERATOR_KEY:-}" ]; then
    # Operator-Exchange abgelehnt (z.B. Delegation widerrufen) → Owner-Fallback.
    echo "[auth] operator exchange rejected — falling back to owner token" >&2
    t=$(curl -sS --max-time 15 -X POST "$SP/api/cli/exchange" -H 'content-type: application/json' \
          -d "$(SUBJ="$(idp)" python3 -c 'import json,os;print(json.dumps({"subject_token":os.environ["SUBJ"]}))')" \
        | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')
  fi
  [ -n "$t" ] || { echo "exchange failed at $SP (apes login?)" >&2; exit 3; }
  printf '%s' "$t" > "$CACHE"; printf '%s' "$t"
}
# troop: ohne Cache sofort minten (sonst ginge der rohe Owner-Token durch und
# der Operator-Pfad würde nie benutzt). Services: wie bisher raw-first.
# Stale-Guard: ein Owner-Fallback-Token (kein scope-Claim, 30d TTL) im Cache
# würde den Operator-Pfad sonst bis zu 30 Tage aushebeln, weil er nie 401t
# (Fund 28.07.: Cache von 15:40 überlebte das Operator-Setup).
cache_is_stale_owner() { # op-enabled Audience + Cache-Token ohne scope = alter Owner-Fallback
  op_enabled_for "$1" && [ -n "${OPERATOR_KEY:-}" ] || return 1
  CACHE="$CACHE" python3 -c 'import base64,json,os,sys
t=open(os.environ["CACHE"]).read().split(".")[1]
c=json.loads(base64.urlsafe_b64decode(t+"="*(-len(t)%4)))
sys.exit(0 if not c.get("scope") else 1)' 2>/dev/null
}
authtok() {
  local aud
  aud=$(printf '%s' "$SP" | sed -E 's|https?://||; s|/.*$||')
  if [ -s "$CACHE" ] && ! cache_is_stale_owner "$aud"; then cat "$CACHE"
  # Freigeschaltete Audiences minten sofort (Operator-Pfad) — sonst ginge der
  # rohe Owner-Token durch und die Delegation würde nie benutzt.
  elif op_enabled_for "$aud" && [ -n "${OPERATOR_KEY:-}" ]; then mint
  else idp; fi
}
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
  ensure-op-auth) # #1036 Endgame: Standard-Agent-Token (aud apes-cli, 8h) fuer ape-shell.
    # BEWUSST OHNE delegation_grant: der delegierte Pfad traegt sub=Owner —
    # Grants wuerden Patrick zugerechnet und der YOLO-Policy-Key (requester =
    # Operator) liefe ins Leere. Der Standard-Agent-Pfad traegt sub=Operator
    # (verifiziert 2026-07-28: Grant requester=Operator, auto_approval=yolo).
    # Block 4: optionales Org-Arg — Key/auth des FIRMEN-Operators aus
    # operators.json; ohne Arg der Legacy-Single-Operator.
    ORG_ARG="${1:-}"
    OP_AUTH="$HOME/.config/openape-worker/op-home/.config/apes/auth.json"
    if [ -n "$ORG_ARG" ]; then
      MAP="$HOME/.config/openape-worker/operators.json"
      row=$(ORG="$ORG_ARG" MAP="$MAP" python3 -c 'import json,os
m=json.load(open(os.environ["MAP"])).get(os.environ["ORG"]) or {}
print(m.get("email",""), m.get("key",""), m.get("auth",""))' 2>/dev/null) || row=""
      read -r OP_EMAIL OP_KEY OP_AUTH_MAPPED <<< "$row"
      [ -n "${OP_AUTH_MAPPED:-}" ] || { echo "[op] org $ORG_ARG nicht in operators.json" >&2; exit 4; }
      OPERATOR_EMAIL="$OP_EMAIL"; OPERATOR_KEY="$OP_KEY"; OP_AUTH="$OP_AUTH_MAPPED"
      export OPERATOR_EMAIL OPERATOR_KEY
    fi
    mkdir -p "$(dirname "$OP_AUTH")"
    if OP_AUTH="$OP_AUTH" python3 - <<'PYEOF'
import json, os, sys, time
try:
    d = json.load(open(os.environ['OP_AUTH']))
    sys.exit(0 if d.get('expires_at', 0) - time.time() > 1800 else 1)
except Exception:
    sys.exit(1)
PYEOF
    then exit 0; fi
    [ -n "${OPERATOR_KEY:-}" ] && [ -f "$OPERATOR_KEY" ] || { echo "[op] kein operator key" >&2; exit 3; }
    tok=$(node - <<'NODEOF'
const { createPrivateKey, sign, randomUUID } = require('node:crypto')
const { readFileSync } = require('node:fs')
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const env = process.env
const key = createPrivateKey(readFileSync(env.OPERATOR_KEY))
const now = Math.floor(Date.now() / 1000)
const h = b64({ alg: 'EdDSA', typ: 'JWT' })
const p = b64({ iss: env.OPERATOR_EMAIL, sub: env.OPERATOR_EMAIL, aud: `${env.OPERATOR_IDP}/token`, jti: randomUUID(), iat: now, exp: now + 300 })
const jwt = `${h}.${p}.` + sign(null, Buffer.from(`${h}.${p}`), key).toString('base64url')
fetch(`${env.OPERATOR_IDP}/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
  grant_type: 'client_credentials',
  client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
  client_assertion: jwt,
}) }).then(async (r) => {
  if (!r.ok) { console.error(`[op] /token HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`); process.exit(1) }
  const d = await r.json(); process.stdout.write(d.access_token || '')
}).catch((e) => { console.error('[op] fetch failed:', e?.cause?.code ?? e?.message ?? e); process.exit(1) })
NODEOF
    ) || { echo "[auth] op agent-token mint failed" >&2; exit 3; }
    [ -n "$tok" ] || { echo "[auth] op agent-token mint returned empty" >&2; exit 3; }
    OP_AUTH="$OP_AUTH" TOK="$tok" python3 - <<'PYEOF'
import json, os, time
json.dump({
    'email': os.environ.get('OPERATOR_EMAIL', ''),
    'idp': os.environ.get('OPERATOR_IDP', 'https://id.openape.ai'),
    'access_token': os.environ['TOK'],
    # 5 min Puffer unter der 8h-Server-TTL, damit der Cache-Check nie
    # einen Token durchwinkt, der serverseitig schon abgelaufen ist.
    'expires_at': int(time.time()) + 8 * 3600 - 300,
}, open(os.environ['OP_AUTH'], 'w'), indent=2)
PYEOF
    chmod 600 "$OP_AUTH"
    echo "[op] agent token refreshed (8h)"
    ;;
  ensure-delegations) # idempotent: pro enabled Service eine Operator-Delegation sicherstellen (#1033).
    # Erzeugung braucht den OWNER-Token (nur act:'human' darf delegieren, delegation.md §7.4).
    # Scopes = konventionelles read/write-Paar: funktioniert mit ALTEM enforceScope
    # (prefix-Konvention) UND neuem (Katalog-Fallback) — bis Services eigene Kataloge haben.
    [ -n "${OPERATOR_EMAIL:-}" ] || { echo "kein operator.env — nichts zu tun" >&2; exit 0; }
    SP="$TROOP" TP="/api/cockpit" CACHE="/tmp/cockpit-sp-$(printf '%s' "$TROOP" | shasum | cut -c1-12).tok" \
      call GET /api/cockpit/services > /tmp/op-services.json
    OWNER_TOKEN="$(idp)" python3 - <<'PYEOF'
import json, os, urllib.request
IDP = os.environ.get('OPERATOR_IDP', 'https://id.openape.ai')
OP = os.environ['OPERATOR_EMAIL']
TOK = os.environ['OWNER_TOKEN']
MAP = os.path.expanduser('~/.config/openape-worker/operator-grants.json')
def api(method, path, body=None):
    req = urllib.request.Request(f'{IDP}{path}', method=method,
        data=json.dumps(body).encode() if body else None,
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r: return json.loads(r.read())
services = [s for s in json.load(open('/tmp/op-services.json')) if s.get('enabled')]
# grants.md §5: Liste kann paginiert ({data, pagination}) oder nackt sein.
resp = api('GET', '/api/delegations?role=delegator')
existing = resp if isinstance(resp, list) else resp.get('data', [])
def active_for(aud):
    for d in existing:
        r = d.get('request', {})
        if d.get('status') == 'approved' and r.get('delegate') == OP and r.get('audience') == aud:
            return d['id']
    return None
grants = {}
try: grants = json.load(open(MAP))
except Exception: pass
for s in services:
    aud = s['baseUrl'].split('//')[-1].split('/')[0]
    gid = active_for(aud)
    if not gid:
        d = api('POST', '/api/delegations', {
            'delegate': OP, 'audience': aud,
            'scopes': ['sp-tasks:read', 'sp-tasks:write'],
            'grant_type': 'timed', 'duration': 30 * 24 * 3600})
        gid = d['id']
        print(f'+ Delegation erzeugt: {aud} -> {gid[:8]}')
    else:
        print(f'= Delegation vorhanden: {aud} -> {gid[:8]}')
    grants[aud] = gid
json.dump(grants, open(MAP, 'w'), indent=1)
os.chmod(MAP, 0o600)
print(f'Map: {MAP} ({len(grants)} Audiences)')
PYEOF
    ;;
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
  next)      # Cockpit-Claim: optionaler Company-Ausschluss (#1262) — nur fuer die
    # troop-Queue, Service-Queues (SVC_URL gesetzt) kennen keine Companies.
    if [ -z "${SVC_URL:-}" ] && [ -n "${OPENAPE_WORKER_EXCLUDE_COMPANIES:-}" ]; then
      call POST "$TP/next" "$(python3 -c 'import json,os;print(json.dumps({"excludeCompanies":[c.strip() for c in os.environ["OPENAPE_WORKER_EXCLUDE_COMPANIES"].split(",") if c.strip()]}))')"
    else
      call POST "$TP/next"
    fi ;;
  yolo-report) # always troop; stdin = JSON body {orgId,opEmail,mode,patternCount,tools,ok,error}
    SP="$TROOP" CACHE="/tmp/cockpit-sp-$(printf '%s' "$TROOP" | shasum | cut -c1-12).tok" \
      call POST /api/cockpit/agent/yolo-sync "$(cat)" ;;
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
