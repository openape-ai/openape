# Migrating a host-installed nest + agents to the container pod

For operators who started with the bare-host setup (macOS launchd-nest
+ uv-installed LiteLLM) and want to switch over to the OpenApe pod
(`docker compose` from this directory) without losing DDISA agent
identities or chat history.

**Scope:** preserves each agent's identity (`<name>+<owner>@id.openape.ai`,
ssh keypair, X25519 capability seal, sealed secret blobs) so that
chat.openape.ai sees the same agent on the other side after the
switch — contacts stay accepted, history stays anchored.

---

## Prerequisites

- Pod up and running (`docker compose -f compose/docker-compose.yml up -d`).
- Container-nest enrolled + YOLO-authorized (see `compose/MIGRATION-CODER.md`).
- The operator's `apes login` on the host still works (we'll use
  `apes run --as root` to read the host agents' protected files).

---

## Step 1 — Backup the host agents' identity files

Tars per agent: `.config`, `.ssh`, `.claude`, `litellm/.env`. The
`apes run --as root` flow drives `tar` because `/var/openape/homes/*`
is mode-600 owned by each agent.

```bash
BACKUP=~/openape-migration-backup-$(date -u +%F)
mkdir -p "$BACKUP/homes-tar"

apes run --as root --wait -- bash -c '
set -e
BACKUP='"$BACKUP"'
cd /var/openape/homes
for a in $(ls -1); do
  [ -d "$a/.config" ] && {
    set --
    for d in .config .ssh .claude litellm; do
      [ -e "$a/$d" ] && set -- "$@" "$a/$d"
    done
    [ $# -gt 0 ] && tar -czf "$BACKUP/homes-tar/$a.tgz" "$@"
  }
done
ls -lh "$BACKUP/homes-tar/"
'
```

Also grab each agent's `agent.json` (system prompt + tool list from
the last `apes agents sync`):

```bash
apes run --as root --wait -- bash -c '
for a in $(ls -1 /var/openape/homes); do
  echo "===$a==="
  cat /var/openape/homes/$a/.openape/agent/agent.json 2>&1 || true
done
' > "$BACKUP/agent-configs.out"
```

---

## Step 2 — Restore each agent's home into the container

For each agent:

```bash
# 1. Copy the backup tarball + agent.json into the nest container.
docker cp "$BACKUP/homes-tar/<host-username>.tgz" openape-nest:/tmp/

# 2. Create the user (uid is auto-assigned; identity is in auth.json,
#    not uid). Restore the home contents preserving permissions.
docker exec openape-nest sh -c '
useradd -m -d /var/lib/openape/homes/<bridge-name> -s /bin/bash <bridge-name>
cd /var/lib/openape/homes/<bridge-name>
tar -xzf /tmp/<host-username>.tgz --strip-components=1
find . -name "._*" -delete   # macOS resource forks
mkdir -p .openape/agent
cat > .openape/agent/agent.json <<JSON
<paste the agent.json body from $BACKUP/agent-configs.out>
JSON
# Point the bridge at the pod LLM (in-pod hostname, not 127.0.0.1).
mkdir -p litellm
cat > litellm/.env <<ENV
LITELLM_BASE_URL=http://openape-llm:4000/v1
LITELLM_API_KEY=sk-litellm-troop-local
APE_CHAT_BRIDGE_MODEL=gpt-5.4
ENV
chown -R <bridge-name>:<bridge-name> /var/lib/openape/homes/<bridge-name>
'
```

Notes:
- `<host-username>` is what `dscl` knew the agent as
  (e.g. `openape-agent-coder`, `ape-agent-iurio`).
- `<bridge-name>` is the agent's bridge identity — the bare name
  (e.g. `coder`, `iurio`). Use it consistently in the registry +
  pm2 app names so the pod doesn't fork the identity.

---

## Step 3 — Update the container nest's registry

The nest reads `$HOME/agents.json` (HOME=`/var/lib/openape/nest` inside
the container) and the schema requires `"version": 1`:

```bash
docker exec openape-nest sh -c '
cat > /var/lib/openape/nest/agents.json <<JSON
{
  "version": 1,
  "agents": [
    {
      "name": "<bridge-name>",
      "uid": '"$(id -u <bridge-name>)"',
      "home": "/var/lib/openape/homes/<bridge-name>",
      "email": "<from-the-host-agents.json>",
      "registeredAt": <unix-seconds-from-host-agents.json>,
      "bridge": {}
    },
    ...
  ]
}
JSON
'
```

The nest's file-watcher picks up the change within a few seconds and
the pm2-supervisor spawns / connects each agent's bridge.

Verify in the logs:

```bash
docker logs openape-nest | grep "bridge online"
# →
# pm2-supervisor: coder bridge online (pm2)
# pm2-supervisor: iurio bridge online (pm2)
# ...
```

And each bridge should log its DDISA connect:

```bash
docker exec openape-nest sh -c 'sudo -n -H -u coder pm2 logs openape-bridge-coder --lines 5 --nostream --err'
# → connected as coder-…@id.openape.ai → https://chat.openape.ai
```

---

## Step 4 — Stop the host bridges

Both the host bridge AND the container bridge will try to claim the
same DDISA identity if you leave both running. The container one is
the new home; turf the host instances:

```bash
for a in openape-agent-coder ape-agent-iurio stephan bluesky; do
  apes run --as "$a" --wait -- pm2 delete "openape-bridge-${a#openape-agent-}" \
    2>&1 | tail -2
done
```

---

## Step 5 — Stop the host nest supervisor

The host nest's launchd plist is at
`~/Library/LaunchAgents/ai.openape.nest.plist`. Bootout is reversible
— the plist stays on disk, `launchctl bootstrap` resurrects it:

```bash
launchctl bootout gui/$UID/ai.openape.nest
```

(For a fully irreversible cleanup — deleting the dscl records, the
homes under `/var/openape/`, the launchd plist itself — see
`compose/MILESTONE-J-PROPOSAL.md`. Don't do that until the container
has run unattended for at least a few days.)

---

## Step 6 — Stop the host LiteLLM

If you were running LiteLLM directly on the host (e.g. via `uv tool
install litellm`), it's already redundant: the pod's `openape-llm`
container is bound to the same `127.0.0.1:4000` port and serves the
same `gpt-5.4` model via the same ChatGPT-OAuth flow (it mounts your
host's `~/.config/litellm/chatgpt/` for the OAuth tokens).

```bash
pkill -f "/.local/share/uv/tools/litellm" || true
# No auto-start to disable — uv-installed CLIs don't register with launchd.
```

---

## Reversibility

Everything in Steps 1–6 is reversible until you do the Milestone J
deletions. To roll back:

1. `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/ai.openape.nest.plist`
2. Re-launch the host LiteLLM:
   `litellm --config ~/.config/litellm/config.yaml --port 4000 &`
3. For each agent: `apes run --as <host-username> -- pm2 startOrReload /var/openape/agents/<name>/ecosystem.config.js`
4. `docker compose -f compose/docker-compose.yml down`

The chat-bridge clients will reconnect to the host nest's supervised
bridges within ~2s of the host nest coming back up.
