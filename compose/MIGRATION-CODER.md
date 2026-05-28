# Migrate the `coder` agent to the container nest

E2E proof that an agent provisioned + supervised inside the OpenApe pod
behaves identically to the historical bare-host macOS path.

## Prerequisites

- `compose/docker-compose.yml` running (`docker compose -f compose/docker-compose.yml up --build -d`)
- `curl http://127.0.0.1:9091/health` → `200 OK`
- `curl http://127.0.0.1:4000/health/liveliness` → `200 OK`
- A registered DDISA identity on the host operator's machine
  (`apes login patrick@hofmann.eco` once before)

## Steps

### 1. Enroll the container nest with troop

Inside the container the nest needs its own DDISA agent identity so
`apes run --as root --` etc. resolve against a YOLO-policy holder that
isn't the human. Once per nest:

```bash
docker exec -it openape-nest sh -c 'apes nest enroll'
# Follow the OAuth flow → opens id.openape.ai on the host browser.

docker exec -it openape-nest sh -c 'apes nest authorize'
# Sets YOLO-policy for `apes agents spawn *` / `destroy *` etc.
```

The enroll command writes `/var/lib/openape/nest/auth.json`; the
docker-compose volume persists it across container restarts.

### 2. Spawn the coder agent via troop

From the troop UI: `Agents → New from recipe → coding-agent`.
Recipe params:

| Param  | Value                                  |
|--------|----------------------------------------|
| repo   | `https://github.com/openape-ai/openape` |
| forge  | `github`                               |

Capabilities (the deploy form will prompt):

| Env       | Value                       | Notes                                 |
|-----------|-----------------------------|---------------------------------------|
| GH_TOKEN  | fine-grained PAT, repo scope| Sealed to the coder's X25519 pubkey   |

Behind the scenes troop POSTs `/agents` to the in-pod nest; the nest
runs `apes agents spawn coder --bridge` which goes through the SAME
HostPlatform.runPrivilegedBash boundary it used on macOS — but inside
the container `process.getuid?.() === 0` is true, so the privileged
exec short-circuits to `bash <script>` (no DDISA grant prompt, no sudo
escalation, no human approval flow). One container, one transaction.

### 3. Drive the agent end-to-end

```bash
# Open an issue with the `agent` label on the target repo.
gh issue create --repo openape-ai/openape \
  --title "test: coder container migration smoke" \
  --label agent \
  --body "Append \`smoke-test\` to README.md"

# Wait up to 10 min for the next cron tick.
# (Or trigger immediately:)
docker exec -it openape-nest sh -c "apes run --as coder -- apes agents code --poll-label agent --repo https://github.com/openape-ai/openape --forge github"
```

Verify:

```bash
gh pr list --repo openape-ai/openape --label agent
# → a fresh PR titled "fix: test: coder container migration smoke (#NN)"
```

The PR was opened by the coder's GitHub identity (matched against
`GH_TOKEN`), branch-protection rules + reviewer gate apply unchanged,
`autoMergeEnabled=false` keeps the merge step human-gated.

### 4. Teardown

```bash
docker exec -it openape-nest sh -c 'apes agents destroy coder --force'
```

The nest's userdel + supervisor-unit-remove + IdP-deregister flow
runs inside the container — no macOS code reached, no tombstones,
clean exit.

## What this proves

| Property                                           | macOS path                       | Container path (this milestone)   |
|----------------------------------------------------|----------------------------------|-----------------------------------|
| Single grant prompt per spawn                      | DDISA-via-escapes (apes run)     | direct bash (already root in pod) |
| Bridge supervisor restarts on crash                | launchd KeepAlive                | systemd Restart=always (or pm2)   |
| Sealed secrets survive across restarts             | sealed blob → ~/.config/openape  | sealed blob → /var/lib/.../secrets|
| Coder opens PR within 1 cron tick of issue create  | yes                              | yes                               |

When all four hold inside the pod, Milestone F is done.
