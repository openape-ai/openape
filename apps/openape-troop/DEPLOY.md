# Deploying troop.openape.ai

> One-time bootstrap, then `scripts/deploy-troop.sh` (called by GitHub Actions on every push to main).

Mirrors the layout of the other `apps/openape-*` services on the deploy host.

## One-time bootstrap

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

Then start it once:

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

GitHub Actions handles them on every push to `main` that touches `apps/openape-troop/**` or related dependencies — see `.github/workflows/deploy-troop.yml`. Manual fallback: `./scripts/deploy-troop.sh` from the monorepo root with `chatty` SSH alias configured.
