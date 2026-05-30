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

exec "$@"
