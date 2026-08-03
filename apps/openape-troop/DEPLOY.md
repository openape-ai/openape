# Deploying troop.openape.ai

Troop runs on chatty as a container from `registry.openape.ai`, deployed from your machine:

```bash
pnpm run deploy:image troop
```

That builds the app locally, packages `.output` into an amd64 image, smoke-tests `/api/health` against it, pushes it, and lets chatty pull and swap the container — then an external health gate, with automatic rollback to the previous tag if it fails. The compose service and its volume/env wiring live in `compose/chatty.yml`; the orchestration is `scripts/deploy-image.mjs`.

Prerequisites: SSH access as `openape@chatty.delta-mind.at` and a `docker login registry.openape.ai`.

The container reuses the host state described below — `/home/openape/projects/openape-troop/shared` is mounted at the identical path, so the `.env` and the SQLite files stay where they are.

## Emergency fallback: the systemd unit

The pre-container path is still installed and intact, just disabled. Bring it back with `sudo systemctl start openape-troop` (as `ubuntu`) after stopping the container — both bind port 3010. `pnpm deploy troop` (`scripts/deploy-troop.sh`) is the deploy that feeds it: build → rsync to `releases/<TS>` → swap `current` → restart the unit → health-check, with rollback on failure. Requires passwordless sudo for `systemctl restart openape-troop.service`.

## Host bootstrap (once per host)

The systemd unit, nginx vhost and sudoers fragment below are what a fresh host needs; they are also what the dormant fallback runs on.

```bash
ssh ubuntu@chatty.delta-mind.at sudo bash -s <<'EOF'
set -euo pipefail

# 1) systemd unit
cat > /etc/systemd/system/openape-troop.service <<'UNIT'
[Unit]
Description=OpenApe Troop (troop.openape.ai)
After=network.target

[Service]
Type=simple
User=openape
WorkingDirectory=/home/openape/projects/openape-troop/current
EnvironmentFile=/home/openape/projects/openape-troop/shared/.env
ExecStart=/usr/bin/node /home/openape/projects/openape-troop/current/server/index.mjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

# 2) nginx vhost (HTTP only — certbot adds :443 block)
cat > /etc/nginx/sites-available/troop.openape.ai <<'NGINX'
server {
  listen 80;
  server_name troop.openape.ai;

  location / {
    proxy_pass http://127.0.0.1:3010;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
    client_max_body_size 2m;
  }
}
NGINX
ln -sf /etc/nginx/sites-available/troop.openape.ai /etc/nginx/sites-enabled/troop.openape.ai
nginx -t
systemctl reload nginx

# 3) Sudoers: let the openape user restart this service in deploys
echo 'openape ALL=(root) NOPASSWD: /bin/systemctl restart openape-troop.service' \
  > /etc/sudoers.d/openape-troop
chmod 440 /etc/sudoers.d/openape-troop
EOF
```

## Persistent env on the host

`/home/openape/projects/openape-troop/shared/.env` (chmod 600) holds the runtime secrets — Turso URL/token, session secret. Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Required vars:

```
NUXT_OPENAPE_SP_SESSION_SECRET=<32 random bytes hex>
NUXT_TURSO_URL=libsql://<your-troop-db>.turso.io
NUXT_TURSO_AUTH_TOKEN=<turso token>
NITRO_PORT=3010
```

This file is what the container reads too — `compose/chatty.yml` passes it as `env_file`, so it stays the single place secrets live.

To run the app from the systemd unit instead of the container:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now openape-troop.service
```

## TLS

```bash
sudo certbot --nginx -d troop.openape.ai --non-interactive --agree-tos -m phofmann@delta-mind.at --redirect
```

## DNS

```bash
exo dns add A openape.ai -n troop -a 85.217.175.26 -t 300
```

## Recurring deploys

`pnpm run deploy:image troop` from the monorepo root — see the top of this file.
