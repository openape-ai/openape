#!/usr/bin/env bash
# One-shot root bootstrap for troop.openape.ai on chatty.
#
# Run as root on the deploy host (chatty.delta-mind.at). The
# project tree + .env are already created by the openape user
# (idempotent — re-running is safe).
#
# Usage on chatty as root:
#   curl -fsSL https://raw.githubusercontent.com/openape-ai/openape/refactor/tribe-to-troop/apps/openape-troop/scripts/bootstrap-chatty-root.sh | bash
#
# Or paste this whole script into a root shell.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "must run as root (use sudo -i)" >&2
  exit 1
fi

echo "==> systemd unit"
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
Environment=PORT=3010
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT

echo "==> sudoers fragment (openape may restart openape-troop.service)"
echo 'openape ALL=(root) NOPASSWD: /bin/systemctl restart openape-troop.service' \
  > /etc/sudoers.d/openape-troop
chmod 440 /etc/sudoers.d/openape-troop

echo "==> nginx vhost (HTTP — certbot upgrades to HTTPS)"
cat > /etc/nginx/sites-available/troop.openape.ai <<'NGINX'
server {
    listen 80;
    server_name troop.openape.ai;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX
ln -sf /etc/nginx/sites-available/troop.openape.ai /etc/nginx/sites-enabled/troop.openape.ai

echo "==> Reload systemd + nginx (don't start service yet — current symlink only appears on first deploy)"
systemctl daemon-reload
systemctl enable openape-troop.service
nginx -t
systemctl reload nginx

echo "==> certbot (DNS for troop.openape.ai must already point at this host)"
certbot --nginx -d troop.openape.ai --non-interactive --agree-tos -m phofmann@delta-mind.at --redirect

echo
echo "✓ Bootstrap done. Now merge PR #331 — GitHub Actions deploys, then https://troop.openape.ai/ should respond 200."
echo
echo "Optional cleanup of old tribe (after troop is verified live):"
echo "  systemctl disable --now openape-tribe.service"
echo "  rm /etc/systemd/system/openape-tribe.service /etc/sudoers.d/openape-tribe /etc/nginx/sites-enabled/tribe.openape.ai"
echo "  systemctl daemon-reload && nginx -t && systemctl reload nginx"
