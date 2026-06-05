# chatty Docker deploys (pilot: troop)

The tested-image pipeline ships a locally-verified multi-arch image to GHCR,
then runs it on chatty via `docker compose`. nginx/TLS is unchanged — the
container publishes `127.0.0.1:3010` exactly where the troop vhost already
points. The systemd `openape-troop.service` stays **dormant** (stopped +
disabled) as an instant fallback during the pilot.

## chatty compose dir layout

`$CHATTY_COMPOSE_DIR` (default `/home/openape/projects/openape-compose/`):

```
chatty.yml        # rsynced from the repo (compose/chatty.yml)
.env              # machine-managed by deploy-image.mjs: REGISTRY, TROOP_TAG, TROOP_TAG_PREV
.env.troop        # HUMAN-managed secrets (Turso, session secret, …). gitignored. chmod 600.
```

`.env` is the compose interpolation source (`${TROOP_TAG}`); `.env.troop` is
the container `env_file`. They are deliberately separate.

## One-time setup (human-gated — needs credentials)

1. **GHCR PATs + login**
   - Mac (push): PAT with `write:packages` → `docker login ghcr.io -u <user>`.
   - chatty (pull): PAT with `read:packages` → `docker login ghcr.io -u <user>`.
   - Ensure the `openape-troop` org package is private and chatty's PAT can read it.
2. **Compose dir on chatty**
   ```bash
   ssh openape@chatty.delta-mind.at 'mkdir -p /home/openape/projects/openape-compose'
   rsync -az compose/chatty.yml openape@chatty.delta-mind.at:/home/openape/projects/openape-compose/
   ```
3. **`.env.troop` on chatty** — copy the real runtime env (Turso URL+token,
   session secret, IdP URL, …) from the current systemd unit / app config
   into `/home/openape/projects/openape-compose/.env.troop`; `chmod 600`.
   Template: `compose/.env.troop.example`.

## Deploy

From the Mac (monorepo root), after `docker login ghcr.io`:
```bash
pnpm deploy:image troop                 # build multi-arch, push, deploy, health-check
pnpm deploy:image troop --dry-run       # plan only
pnpm deploy:image troop --build-only    # push image, skip chatty deploy
pnpm deploy:image troop --rollback      # re-up the previous pinned tag
```

## Cutover (human-gated — prod action, needs your go)

# Privileged systemctl runs as `ubuntu` — the `openape` user's sudoers.d
# fragment only covers `systemctl restart openape-*.service`, NOT stop/disable/
# enable. docker compose needs no sudo, so it stays as `openape`.
```bash
ssh ubuntu@chatty.delta-mind.at 'sudo systemctl stop openape-troop.service && sudo systemctl disable openape-troop.service'
pnpm deploy:image troop
curl -s -o /dev/null -w '%{http_code}\n' https://troop.openape.ai/    # expect 200
ssh openape@chatty.delta-mind.at 'docker ps --filter name=openape-troop'   # healthy
```
Leave the unit installed-but-dormant. To fall back instantly:
```bash
ssh openape@chatty.delta-mind.at 'cd /home/openape/projects/openape-compose && docker compose -f chatty.yml down openape-troop'
ssh ubuntu@chatty.delta-mind.at 'sudo systemctl enable --now openape-troop.service'
```
