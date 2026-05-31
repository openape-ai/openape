# Deploying org.openape.ai

> Mirrors the layout of the other `apps/openape-*` services on `chatty.delta-mind.at`. One-time bootstrap, then `scripts/deploy-org.sh` (called by `.github/workflows/deploy-org.yml` on every push to main).

## One-time bootstrap (run by Patrick, not the agent)

```bash
ssh ubuntu@chatty.delta-mind.at sudo bash -s <<'EOF'
set -euo pipefail

# 1) systemd unit
cat > /etc/systemd/system/openape-org.service <<'UNIT'
[Unit]
Description=OpenApe Org (org.openape.ai)
After=network.target

[Service]
Type=simple
User=openape
WorkingDirectory=/home/openape/projects/openape-org/current
EnvironmentFile=/home/openape/projects/openape-org/shared/.env
ExecStart=/usr/bin/node /home/openape/projects/openape-org/current/server/index.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable openape-org.service

# 2) Sudoers fragment for the deploy user
cat > /etc/sudoers.d/openape-org <<'SUDO'
openape ALL=(root) NOPASSWD: /bin/systemctl restart openape-org.service
SUDO
chmod 0440 /etc/sudoers.d/openape-org

# 3) Release layout
mkdir -p /home/openape/projects/openape-org/{releases,shared}
chown -R openape:openape /home/openape/projects/openape-org
EOF
```

Then as the `openape` user:

```bash
ssh openape@chatty.delta-mind.at "cat > /home/openape/projects/openape-org/shared/.env" <<'ENV'
PORT=3020
NUXT_OPENAPE_CLIENT_ID=org.openape.ai
NUXT_OPENAPE_SP_NAME=OpenApe Org
NUXT_OPENAPE_SP_SESSION_SECRET=<rotate-me-32+-chars>
NUXT_OPENAPE_URL=
NUXT_OPENAPE_SP_FALLBACK_IDP_URL=https://id.openape.ai
NUXT_PUBLIC_IDP_URL=https://id.openape.ai
NUXT_TROOP_API_BASE=https://troop.openape.ai
NUXT_PUBLIC_TROOP_UI_BASE=https://troop.openape.ai
NUXT_TURSO_URL=libsql://<your-org-db>.turso.io
NUXT_TURSO_AUTH_TOKEN=<turso-token>
ENV
chmod 600 /home/openape/projects/openape-org/shared/.env
```

## DNS + nginx

- DNS A record: `org.openape.ai` → chatty's IP
- nginx vhost reverse-proxies `org.openape.ai` → `127.0.0.1:3020`, same template as `troop.openape.ai`
- Cert: certbot for `org.openape.ai`

## Register the SP at id.openape.ai

Add `org.openape.ai` as an OIDC client at id.openape.ai with redirect URI `https://org.openape.ai/api/auth/callback` (same scheme as troop). The shared session-secret in `.env` does NOT need to be registered server-side — it's local-only.

## After bootstrap

`scripts/deploy-org.sh` (and the GH workflow that calls it) handles every subsequent release: build → rsync → libsql native-binding pin → symlink swap → systemctl restart → health check → rollback on failure.

## M4 — Cross-SP spawn (not yet wired)

The previous draft of M4 (PR #519) modeled org as a DDISA *agent identity*. That misuses the agent primitive — agents are human-created delegates, not services. The correct model per `openape-ai/protocol/sp-data-access.md` is:

- **org is just a DDISA domain string** in delegation grants' `delegate` field — no `apes enroll` for SPs
- **troop publishes a scope catalog** at `/.well-known/openape.json#scopes` (e.g. `troop:spawn-agent`)
- **troop exposes `/api/cli/exchange`** that accepts the Owner's AuthZ-JWT and mints a troop-scoped access token (pattern already implemented in `openape-chat`)
- **Owner consents** via a standing delegation grant at id.openape.ai (browser flow or CLI)
- **org's spawn endpoint** fetches the AuthZ-JWT via `/api/grants/{id}/token`, exchanges at troop, calls spawn-intent

Implementation lives in a separate plan; the org UI today shows only "Link existing" on placeholder cards.
