---
"@openape/nest": patch
---

Make the nest usable behind a local `tls internal` proxy and stop reload-thrash
on the registry-poll fallback. All prod-neutral (the env vars are unset in
production, where the bridge talks to a publicly-trusted endpoint):

- Forward `NODE_EXTRA_CA_CERTS` and `OPENAPE_TROOP_URL` into each bridge's pm2
  `env:` block (sudo strips the nest env), and preserve `NODE_EXTRA_CA_CERTS`
  through `sudo -u <agent>` for `apes agents sync`. A containerized bridge can
  then trust a local CA and target a non-production troop.
- The entrypoint copies a mounted local CA to a world-readable path, since
  Caddy's root-only PKI dir is unreadable by spawned agent uids.
- The registry-watch poll fallback (used when `fs.watch` is unavailable, e.g.
  bind-mounted files in containers) now reconciles only when the registry
  actually changes. The previous blind 5s reconcile ran `pm2 startOrReload`
  for every agent each tick, reloading healthy bridges so they never stayed
  connected; pm2 autorestart covers liveness between registry edits.
