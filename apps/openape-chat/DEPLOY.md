# Deploying chat.openape.ai to chatty

> One-time bootstrap + recurring deploy via `scripts/deploy-chatty-chat.sh`. Mirrors the layout of the other `chatty.delta-mind.at`-hosted services (see `scripts/deploy-chatty.sh` for `id.openape.ai`, `scripts/deploy-chatty-proxy.sh` for `proxy.openape.ai`).

---

## One-time bootstrap on chatty

These steps only run once per host. After this, `./scripts/deploy-chatty-chat.sh` from the monorepo root handles every subsequent deploy.

### 1. Release directory + persistent shared state

```sh
ssh chatty
sudo install -d -o openape -g openape /home/openape/projects/openape-chat
sudo install -d -o openape -g openape /home/openape/projects/openape-chat/releases
sudo install -d -o openape -g openape /home/openape/projects/openape-chat/shared
```

### 2. `shared/.env` — env vars persisted across deploys

```env
# /home/openape/projects/openape-chat/shared/.env
# chmod 600 — only the openape user reads this.

NUXT_OPENAPE_CLIENT_ID=chat.openape.ai
NUXT_OPENAPE_SP_NAME=OpenApe Chat
NUXT_OPENAPE_SP_SESSION_SECRET=<openssl rand -hex 32>
NUXT_OPENAPE_URL=https://id.openape.ai
NUXT_OPENAPE_SP_FALLBACK_IDP_URL=https://id.openape.ai
NUXT_PUBLIC_IDP_URL=https://id.openape.ai

NUXT_TURSO_URL=file:/home/openape/projects/openape-chat/shared/openape-chat.db
NUXT_TURSO_AUTH_TOKEN=

# Generated once with scripts/generate-chat-vapid.sh — keep stable across
# deploys. Rotating the private key while subscriptions exist will silently
# 401 every push until clients re-subscribe.
NUXT_PUBLIC_VAPID_PUBLIC_KEY=<paste>
NUXT_VAPID_PRIVATE_KEY=<paste>
NUXT_VAPID_SUBJECT=mailto:patrick@hofmann.eco

NITRO_PORT=3007
```

Generate the VAPID block locally with:

```sh
./scripts/generate-chat-vapid.sh > /tmp/chat-vapid.env
scp /tmp/chat-vapid.env openape@chatty:/home/openape/projects/openape-chat/shared/.env.vapid
ssh chatty 'cat /home/openape/projects/openape-chat/shared/.env.vapid >> /home/openape/projects/openape-chat/shared/.env && chmod 600 /home/openape/projects/openape-chat/shared/.env && rm /home/openape/projects/openape-chat/shared/.env.vapid'
```

### 3. systemd unit

```ini
# /etc/systemd/system/openape-chat.service

[Unit]
Description=OpenApe Chat (chat.openape.ai)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=openape
Group=openape
WorkingDirectory=/home/openape/projects/openape-chat/current
EnvironmentFile=/home/openape/projects/openape-chat/shared/.env
ExecStart=/usr/bin/node /home/openape/projects/openape-chat/current/server/index.mjs
Restart=on-failure
RestartSec=2s

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/openape/projects/openape-chat/shared
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```sh
sudo cp openape-chat.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable openape-chat.service
```

### 4. Sudoers fragment for passwordless restart

```sh
# /etc/sudoers.d/openape-chat (visudo!)
openape ALL=(root) NOPASSWD: /bin/systemctl restart openape-chat.service, /bin/systemctl status openape-chat.service, /bin/journalctl -u openape-chat *
```

### 5. nginx vhost

```nginx
# /etc/nginx/sites-available/chat.openape.ai

server {
    listen 80;
    listen [::]:80;
    server_name chat.openape.ai;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name chat.openape.ai;

    # ssl_certificate / ssl_certificate_key managed by certbot
    ssl_certificate     /etc/letsencrypt/live/chat.openape.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.openape.ai/privkey.pem;

    # Service worker scope check passes the SW header through unchanged so
    # the browser doesn't refuse to register it at /. Don't strip it.
    proxy_set_header Service-Worker-Allowed /;

    location / {
        proxy_pass http://127.0.0.1:3007;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket upgrade for /api/ws — Nitro's defineWebSocketHandler
        # requires Upgrade + Connection passthrough.
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # WebSocket connections are long-lived; the default 60s read
        # timeout would tear them down on the proxy side. 1h is plenty.
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

```sh
sudo ln -s /etc/nginx/sites-available/chat.openape.ai /etc/nginx/sites-enabled/
sudo certbot --nginx -d chat.openape.ai
sudo nginx -t && sudo systemctl reload nginx
```

### 6. DNS

A/AAAA record for `chat.openape.ai` → chatty's IP. The nginx vhost handles the rest. Coordinate with whoever owns the openape.ai zone.

---

## Recurring deploy

Once the bootstrap is done, every release is just:

```sh
./scripts/deploy-chatty-chat.sh
```

That script:

1. Builds `apps/openape-chat/.output` locally via `pnpm turbo run build --filter @openape/chat`.
2. Rsyncs to `releases/<TS>/`.
3. Pins `@libsql/linux-x64-gnu@0.4.7` (matches the wrapper version we ship).
4. Atomically swaps the `current` symlink.
5. Restarts `openape-chat.service`.
6. Health-checks `http://127.0.0.1:3007/` (HTTP 200/3xx/401/403 all count as up).
7. Prunes old releases, keeping the last 3 for rollback.

### Rollback

```sh
ssh chatty
ls -1t /home/openape/projects/openape-chat/releases/      # pick a prior TS
ln -sfn /home/openape/projects/openape-chat/releases/<TS> /home/openape/projects/openape-chat/current
sudo systemctl restart openape-chat.service
```

---

## PWA icons

The default manifest references the SVG at `public/icon.svg`. Modern browsers (Chrome 100+, Firefox 100+, Safari 16+) install the PWA from SVG alone, but older Android launchers render low-quality home-screen icons without raster sources.

Generate raster fallbacks once with:

```sh
brew install librsvg     # or: brew install imagemagick
./scripts/generate-chat-icons.sh
git add apps/openape-chat/public/icon-{192,512,512-maskable}.png
```

Then update `apps/openape-chat/nuxt.config.ts` to add the PNG entries to the manifest's `icons` array (alongside the SVG, in this order so Chrome prefers the raster):

```ts
icons: [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
  { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
],
```

---

## Health & logs

```sh
ssh chatty
sudo systemctl status openape-chat.service
sudo journalctl -u openape-chat -f
curl -i http://127.0.0.1:3007/api/me   # 401 expected when no session
```

Database lives at `shared/openape-chat.db` (SQLite). Back it up alongside the other chatty SQLite files (`/home/openape/projects/*/shared/*.db`).
