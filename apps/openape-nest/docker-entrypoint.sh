#!/bin/bash
# openape-nest container entrypoint.
#
# Stuff that has to happen on every container start (not just at image
# build) because the volume-backed nest data outlives the container's
# ephemeral /etc/passwd, /var/log, etc.:
#
#   1. /var/log/openape — pre-create, world-writable so per-agent pm2
#      can drop its log file (mode 1777 = sticky-bit on /tmp-style).
#   2. /var/lib/openape/homes/<n> exists for every agent in the
#      registry → useradd matching the home's owning uid so sudo -u
#      <name> resolves. Without this, every `docker compose down/up`
#      strands the bridges (the registry remembers the agents, but
#      /etc/passwd doesn't, and pm2 can't sudo to a non-existent user).
#
# Safe to re-run — every step is idempotent.

set -e

mkdir -p /var/log/openape && chmod 1777 /var/log/openape

# Local-CA trust (dev/test stacks behind a `tls internal` Caddy). Caddy keeps
# its root under a 0700 root-only PKI dir, so an agent uid can't read it to
# trust it. Root (the nest, PID 1) copies it to a world-readable path that the
# bridge + `apes agents sync` point NODE_EXTRA_CA_CERTS at. No-op in prod where
# the CA path is absent and agents talk to a publicly-trusted endpoint.
LOCAL_CA_SRC=/caddy-data/caddy/pki/authorities/local/root.crt
LOCAL_CA_DST=/var/lib/openape/local-ca.crt
if [ -r "$LOCAL_CA_SRC" ]; then
  install -m 0644 "$LOCAL_CA_SRC" "$LOCAL_CA_DST"
  echo "[entrypoint] trusted local CA → $LOCAL_CA_DST"
fi

REGISTRY=/var/lib/openape/nest/agents.json
HOMES=/var/lib/openape/homes

if [ -f "$REGISTRY" ] && [ -d "$HOMES" ]; then
  # Parse agent names + uids from the registry. python3 is in the slim
  # node image (apt installed it as a transitive of one of our deps).
  python3 - <<'PY'
import json, os, pwd, subprocess, sys
try:
    reg = json.load(open('/var/lib/openape/nest/agents.json'))
except Exception as e:
    print(f"[entrypoint] could not read registry: {e}", file=sys.stderr)
    sys.exit(0)
for a in reg.get('agents', []):
    name = a.get('name')
    home = a.get('home')
    uid = a.get('uid')
    if not (name and home and uid):
        continue
    try:
        pwd.getpwnam(name)
        continue  # already exists
    except KeyError:
        pass
    # Reuse the registered uid so the home dir's existing ownership
    # matches the new account — files survive across container recreates.
    cmd = ['useradd', '-m', '-d', home, '-s', '/bin/bash', '-u', str(uid), name]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"[entrypoint] useradd {name} failed: {r.stderr.strip()}", file=sys.stderr)
    else:
        print(f"[entrypoint] useradd {name} uid={uid} home={home}")
    # Re-assert ownership in case the home dir's xattrs were mangled by
    # a previous restore (e.g. tar extraction with mixed source uids).
    subprocess.run(['chown', '-R', f'{name}:{name}', home], check=False)
PY
fi

# --- Codex proxy ----------------------------------------------------------
# The OpenAI-compatible shim the per-agent bridges talk to on loopback:4000,
# replacing the openape-llm/litellm container that M3 collapsed into the nest.
# Non-blocking by design: it serves /health immediately and only fails a chat
# request (clear 502) until troop seeds the ChatGPT credential at
# CODEX_CREDENTIAL_PATH. The seeding agent's broker writes that file once
# (seed-once); the proxy refreshes it in place thereafter.
#
# The dir is world-writable + sticky (like /var/log/openape): the seeding agent
# runs as a non-root, dynamically-uid'd user and must be able to create
# auth.json here — the file itself stays 0600. Run under a restart loop so a
# transient proxy crash doesn't strand model access; the nest stays PID 1 via
# the exec below, and the loop is reaped with the container.
mkdir -p /var/lib/openape/codex && chmod 1777 /var/lib/openape/codex

(
  while true; do
    CODEX_CREDENTIAL_PATH=/var/lib/openape/codex/auth.json \
    CODEX_PROXY_PORT=4000 \
    CODEX_PROXY_HOST=127.0.0.1 \
    node /opt/openape/codex-proxy/dist/bin.js
    echo "[entrypoint] codex-proxy exited ($?) — restarting in 2s" >&2
    sleep 2
  done
) >> /var/log/openape/codex-proxy.log 2>&1 &

exec "$@"
