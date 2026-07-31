#!/usr/bin/env bash
# code-task — Worktree-Runner fuer Code-Arbeit des Dev-Loops (Hebel E, Plan
# 2026-07-30-recurring-grants-ux.md). Code-Aenderungen gehoeren NICHT durchs
# Kommando-Gate (apply_patch-Heredocs -> fail-closed Karten): die natuerliche
# Grenze fuer Code ist der PR-Review. Dieser Runner klont in einen Wegwerf-
# Worktree, laesst codex dort UNGEGATET aber SANDBOXED (workspace-write)
# implementieren, pusht den Branch und oeffnet den PR. main bleibt protected,
# CI + Owner-Review sind das Gate.
#
# Detached by design: der Stall-Watchdog des Workers killt den Operator nach
# STALL_SECS Stream-Stille — ein synchroner 20-Minuten-Lauf im Shell-Kommando
# ist unmoeglich. Also: `start` kehrt sofort zurueck, der Operator resolved
# deferred und fragt spaeter `status` ab.
#
# Die Abkopplung passiert ueber python3 Popen(start_new_session=True), also
# eine ECHTE neue Session (setsid). nohup allein reichte nicht: endet der
# Operator-Task, reisst der Worker dessen Prozessgruppe mit und der Runner
# starb mitten im git clone — 7 stumme Fehlversuche am 30./31.07., failed.txt
# blieb leer, weil nicht mal der fail()-Handler mehr lief. macOS hat kein
# setsid-Binary, daher der Weg ueber python3.
#
#   code-task start <issue-nr> [owner/repo]   # default openape-ai/openape
#   code-task status <issue-nr>               # RUNNING | DONE <pr-url> | FAILED
set -euo pipefail

DIR="$HOME/.config/openape-worker"
BASE_URL="${FJ_BASE:-https://git.openape.ai}"
CODEX_EFFORT="${CODE_TASK_EFFORT:-medium}"

api() { curl -fsS --max-time 30 -H "authorization: token $TOK" "$@"; }

CMD="${1:?usage: code-task start <issue-nr> [owner/repo] | status <issue-nr>}"; shift

case "$CMD" in
  status)
    NR="${1:?issue-nr}"
    JOB="$DIR/code-tasks/$NR"
    [ -d "$JOB" ] || { echo "UNKNOWN — kein Lauf fuer Issue $NR"; exit 1; }
    if [ -f "$JOB/pr-url.txt" ]; then
      echo "DONE $(cat "$JOB/pr-url.txt")"
    elif [ -f "$JOB/failed.txt" ]; then
      echo "FAILED — $(cat "$JOB/failed.txt")"
      echo "--- letzte Log-Zeilen:"
      tail -5 "$JOB/run.log" 2>/dev/null || true
    elif kill -0 "$(cat "$JOB/pid.txt" 2>/dev/null)" 2>/dev/null; then
      echo "RUNNING seit $(stat -f %Sm "$JOB/pid.txt" 2>/dev/null || true)"
    else
      echo "FAILED — Prozess weg ohne Ergebnis"
      tail -5 "$JOB/run.log" 2>/dev/null || true
    fi
    exit 0 ;;
  start) ;;
  *) echo "usage: code-task start <issue-nr> [owner/repo] | status <issue-nr>" >&2; exit 2 ;;
esac

NR="${1:?issue-nr}"
REPO="${2:-openape-ai/openape}"
TOK="${FORGEJO_TOKEN:?FORGEJO_TOKEN fehlt (org vars)}"
API="$BASE_URL/api/v1/repos/$REPO"
JOB="$DIR/code-tasks/$NR"

if [ -f "$JOB/pid.txt" ] && kill -0 "$(cat "$JOB/pid.txt")" 2>/dev/null; then
  echo "RUNNING — Lauf fuer Issue $NR existiert schon (code-task status $NR)"
  exit 0
fi

# Alt-Reste frueherer Versuche wegraeumen, BEVOR der neue Lauf startet — sonst
# sammeln sich Teil-Clones in /tmp (Befund 31.07.: sieben Stueck fuer #1118).
rm -rf "$JOB"; mkdir -p "$JOB"
rm -rf /tmp/code-task-"$NR".* 2>/dev/null || true

# Issue holen + Status pruefen, BEVOR wir detachen: ein Tippfehler oder ein
# laengst geschlossenes Issue soll sofort und sichtbar enden, nicht im
# Hintergrund-Log. Ein geschlossenes Issue ist KEIN Fehler — es gibt nur
# nichts zu tun (der Dev-Loop soll das melden und weiterziehen).
STATE=$(api "$API/issues/$NR" | python3 -c '
import json, sys
i = json.load(sys.stdin)
open(sys.argv[1], "w").write(i["title"] + "\n\n" + (i.get("body") or ""))
print(i["state"])' "$JOB/issue.txt")
if [ "$STATE" != "open" ]; then
  echo "NOTHING-TO-DO — Issue $NR ist '$STATE' (nicht offen). Kein Lauf gestartet."
  rm -rf "$JOB"
  exit 0
fi

TITLE_LINE=$(head -1 "$JOB/issue.txt")

# Token in eine 600er-Datei — der Runner liest sie zur Laufzeit; weder das
# Skript noch die Prozessliste tragen das Secret.
umask 077
printf '%s' "$TOK" > "$JOB/token"
printf 'JOB=%q\nNR=%q\nREPO=%q\nAPI=%q\nEFFORT=%q\nBASE_URL=%q\n' \
  "$JOB" "$NR" "$REPO" "$API" "$CODEX_EFFORT" "$BASE_URL" > "$JOB/env"

cat > "$JOB/runner.sh" <<'RUNNER'
#!/bin/bash
set -uo pipefail
. "$(dirname "$0")/env"
TOK=$(cat "$JOB/token")
fail() { printf "%s" "$1" > "$JOB/failed.txt"; exit 1; }
WT=$(mktemp -d "/tmp/code-task-$NR.XXXXXX")
BRANCH="fix/issue-$NR-code-task"

git -c http.extraHeader="Authorization: token $TOK" clone --filter=blob:none \
  "$BASE_URL/$REPO.git" "$WT" >>"$JOB/run.log" 2>&1 || fail "git clone"
cd "$WT"
git checkout -b "$BRANCH" >>"$JOB/run.log" 2>&1 || fail "branch"

PROMPT="Du arbeitest in einem frischen Checkout von $REPO auf Branch $BRANCH.
Setze das folgende Issue um — minimaler Diff, Konventionen des Repos (siehe
CLAUDE.md/CONTRIBUTING.md im Checkout). Verifiziere deine Aenderung so billig
wie moeglich (betroffene Packages: lint/typecheck via pnpm turbo --filter, wenn
noetig erst pnpm install --frozen-lockfile). Die Sandbox verbietet Schreibzugriffe
auf .git — committe und pushe daher NICHT. Schreibe stattdessen die
Conventional-Commit-Message (EINE Zeile, max 80 Zeichen, kein Co-Author) in die
Datei COMMIT_MSG.txt im Repo-Root; committen und pushen uebernimmt der Runner.
Wenn das Issue nicht sauber umsetzbar ist (unklar, zu gross, oder die Aenderung
existiert schon), aendere NICHTS, lege KEIN COMMIT_MSG.txt an und beende mit
einer kurzen Begruendung.

--- Issue #$NR ---
$(cat "$JOB/issue.txt")"

# Ungegatet, aber eingesperrt: workspace-write haelt Schreibzugriffe im
# Worktree, Netz ist fuer pnpm install noetig. Kein FORGEJO_TOKEN im
# codex-Env — pushen darf nur der Runner.
env -u FORGEJO_TOKEN codex exec "$PROMPT" --skip-git-repo-check -C "$WT" \
  --sandbox workspace-write -c sandbox_workspace_write.network_access=true \
  --disable collaboration_modes -c "model_reasoning_effort=$EFFORT" \
  -o "$JOB/codex-final.txt" >>"$JOB/run.log" 2>&1 || fail "codex exec"

# Der Runner committet (codex darf nicht an .git): Message aus COMMIT_MSG.txt,
# die Datei selbst gehoert nicht in den Commit.
if [ ! -f "$WT/COMMIT_MSG.txt" ]; then
  fail "codex hat nichts umgesetzt: $(head -c 200 "$JOB/codex-final.txt" 2>/dev/null)"
fi
MSG=$(head -1 "$WT/COMMIT_MSG.txt")
rm -f "$WT/COMMIT_MSG.txt"
git add -A >>"$JOB/run.log" 2>&1
git diff --cached --quiet && fail "COMMIT_MSG.txt ohne Aenderungen: $(head -c 200 "$JOB/codex-final.txt" 2>/dev/null)"
git -c user.name="Patrick Hofmann" -c user.email="patrick@hofmann.eco" \
  commit -m "$MSG" >>"$JOB/run.log" 2>&1 || fail "git commit"

git -c http.extraHeader="Authorization: token $TOK" push -u origin "$BRANCH" \
  >>"$JOB/run.log" 2>&1 || fail "git push"

TITLE=$(git log -1 --format=%s)
BODY="Umsetzung von #$NR durch code-task (Worktree-Runner). Abschlussnotiz des Agents:

$(head -c 1500 "$JOB/codex-final.txt" 2>/dev/null)"
python3 -c "
import json, sys
print(json.dumps({\"title\": sys.argv[1], \"head\": sys.argv[2], \"base\": \"main\", \"body\": sys.argv[3]}))" \
  "$TITLE" "$BRANCH" "$BODY" \
  | curl -fsS --max-time 30 -X POST -H "authorization: token $TOK" \
      -H "content-type: application/json" --data-binary @- "$API/pulls" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)[\"html_url\"])" > "$JOB/pr-url.txt" \
  || fail "PR anlegen (Branch $BRANCH ist gepusht)"

rm -rf "$WT"
rm -f "$JOB/token"
RUNNER
chmod 700 "$JOB/runner.sh"

# Echte neue Session (setsid): der Runner ueberlebt das Ende des
# Operator-Tasks und dessen Prozessgruppe.
python3 - "$JOB" <<'PYEOF'
import subprocess, sys
job = sys.argv[1]
with open(f"{job}/run.log", "ab") as log:
    p = subprocess.Popen(["bash", f"{job}/runner.sh"],
                         stdout=log, stderr=log,
                         stdin=subprocess.DEVNULL, start_new_session=True)
open(f"{job}/pid.txt", "w").write(str(p.pid))
PYEOF

echo "STARTED Issue $NR ($TITLE_LINE) — Ergebnis spaeter mit: code-task status $NR"
echo "Empfohlen: resolve deferred (15-25 min), dann status abfragen und PR-URL melden."
