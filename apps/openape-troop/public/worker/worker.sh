#!/usr/bin/env bash
# OpenApe worker — a "dumb" generic task executor + reactive cockpit CEO.
# Serves, headless and 24/7:
#   1) the TROOP COCKPIT chat queue — answers AS the company's CEO (the task
#      carries the CEO systemPrompt built from troop) and heartbeats so the UI
#      shows "CEO live". This replaces the fragile /loop /troop-cockpit-ceo session.
#   2) every sp-tasks SERVICE registered in troop (zaz, …).
# All intelligence lives in troop (each task ships its own systemPrompt +
# userMessage). Tasks stay OPEN: data.tools → the task may use tools (code/bash).
# Answer via headless `claude -p`. Idle = HTTP-only (no tokens).
set -uo pipefail
DIR="$HOME/.config/openape-worker"
CA="$DIR/cockpit-agent.sh"
MODEL="${OPENAPE_WORKER_MODEL:-claude-sonnet-5}"
export CLAUDE_CODE_OAUTH_TOKEN="$(cat "$DIR/token")"

log() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*"; }

generate() { # reads sys.txt/user.txt/tools.txt; prints the (fence-stripped) answer
  local allow ans
  allow=$(cat "$DIR/tools.txt" 2>/dev/null || true)
  ans=$(claude -p "$(cat "$DIR/user.txt")" \
      --append-system-prompt "$(cat "$DIR/sys.txt")" \
      --model "$MODEL" --allowedTools "$allow" \
      --strict-mcp-config --mcp-config '{"mcpServers":{}}' < /dev/null 2>/dev/null || true)
  printf '%s' "$ans" | python3 "$DIR/clean.py"
}

# Answer one already-leased task. The target is selected by the EXPORTED
# SVC_URL/SVC_TASKS in the environment (cockpit when unset). $2=label $3=progress.
answer() {
  local id="$1" label="$2"
  [ "$3" = "1" ] && bash "$CA" progress "$id" "🧠 CEO denkt …" >/dev/null 2>&1 || true
  local ans
  ans=$(generate)
  if [ -n "$ans" ]; then
    printf '%s' "$ans" | bash "$CA" resolve "$id" completed >/dev/null 2>&1
    log "[$label] task ${id:0:8} -> resolved (${#ans} chars)"
  else
    printf '%s' "worker: empty answer" | bash "$CA" resolve "$id" failed >/dev/null 2>&1
    log "[$label] task ${id:0:8} -> FAILED (empty)"
  fi
}

# Drain the currently-targeted queue (cockpit if SVC_* unset, else the service).
drain() { # $1=label  $2=progress(1|0)
  while true; do
    local task id
    task=$(bash "$CA" next 2>/dev/null || true)
    id=$(printf '%s' "$task" | python3 "$DIR/parse.py" "$DIR" 2>/dev/null || true)
    [ -z "$id" ] && break
    worked=1
    log "[$1] task ${id:0:8} -> generating"
    answer "$id" "$1" "$2"
  done
}

log "openape-worker start (model=$MODEL, cockpit + services from troop)"
last_hb=-999

while true; do
  # Keep the reactive CEO shown "live" in the cockpit UI (~every 15s, cheap HTTP).
  if [ $((SECONDS - last_hb)) -ge 15 ]; then
    bash "$CA" heartbeat 20000 >/dev/null 2>&1 || true
    last_hb=$SECONDS
  fi
  worked=0

  # 1) Troop cockpit chat (no SVC env → bare cockpit target).
  unset SVC_URL SVC_TASKS 2>/dev/null || true
  drain cockpit 1

  # 2) Registered sp-tasks services (zaz, …).
  SERVICES=$(bash "$CA" services 2>/dev/null || true)
  while IFS=$'\t' read -r URL TP LABEL; do
    [ -z "$URL" ] && continue
    export SVC_URL="$URL" SVC_TASKS="$TP"
    drain "$LABEL" 0
    unset SVC_URL SVC_TASKS
  done <<< "$SERVICES"

  [ "$worked" -eq 0 ] && sleep 1
done
