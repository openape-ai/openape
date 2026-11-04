# Independent Traefik edge

The Chatty edge uses the digest-pinned [Compose contract](../../compose/traefik/edge.compose.yaml).
The owner is the SSH operator, using project/container `openape-proxy` and
`/srv/openape-proxy/compose.yaml`. Coolify management remains running with its
server proxy type `NONE` (Custom Proxy) and `force_stop=true`. This is operational
separation, not isolation from an administrator with Docker/root privileges.

## Protected runtime contract

The project directory is root-only. Its `.env` contains `ACME_EMAIL`; `dns01.env`
contains the existing DNS provider credentials. The `dynamic/` directory contains
the adopted effective routes, middleware and protected authentication material.
Neither secrets nor the complete private service inventory belong in this repository.
Keep dated protected configuration snapshots and SHA-256 manifests in recovery
storage; update the native issue/PR for changes to this public-safe contract.

Preserve the existing external `coolify` network, gateway and backend bindings.
Do not create a similarly named replacement network. The adoption retains TCP
80/443/8080, UDP 443, Docker/file providers and the original proxy router rule.
The historical network aliases remain for compatibility. Every recreated namespace
must retain `net.mptcp.enabled=0`; do not infer it from the host's sysctl.

`acme.json` and `acme-dns01.json` are live single-writer state, mode 0600. Never
start two resolvers against the same store or replace current certificates/accounts
with a dated backup during a configuration rollback. No application database,
Reports authority or policy journal is part of a proxy rollback.

## Operate

From the configured SSH alias `chatty.delta-mind.at`, as the existing sudo operator:

```sh
sudo docker compose -f /srv/openape-proxy/compose.yaml config --quiet
sudo docker compose -f /srv/openape-proxy/compose.yaml up -d --wait --wait-timeout 30 --no-build --pull never
sudo docker compose -f /srv/openape-proxy/compose.yaml restart traefik
sudo docker inspect openape-proxy --format '{{.State.Health.Status}}'
```

An unchanged `up` must preserve container identity/start time. Docker's
`unless-stopped` policy owns restart; there is no second systemd supervisor.
For route changes, preserve a protected before-copy, validate YAML, install one
reviewed file atomically and verify the actual route plus refusal paths. File
provider watch loads changes without restarting applications. Inspect Traefik
logs and require the affected router to be usable; a healthy ping alone is
insufficient. Do not invoke Coolify's proxy start/update buttons to operate this edge.

## Adoption and rollback

1. Refresh container identities, health, networks, all route/middleware hashes,
   HTTP responses and certificate fingerprints. Preserve the exact original
   container inspection, Compose and Coolify server proxy JSON in a private
   timestamped recovery directory. Record the directory in private evidence.
2. Validate copied routes/current certificates on loopback listeners with production
   ACME issuance disabled. Test real DNS-01 issuance and renewal with a separate
   staging CA account/store/test name; clean up only that test's TXT records.
3. Detach Coolify proxy automation. Verify ordinary check/start/dynamic-generation
   actions leave the adopted files and container unchanged. The independent path
   and name also keep normal old proxy commands away from the new service.
4. Stop the old proxy and disable its restart policy before starting the new one.
   Copy the final current ACME stores only after the old writer stops. Start the
   pinned service and verify all refreshed HTTPS/status/certificate baselines,
   redirects, access boundaries, registry behavior and WebSocket transport.
5. On failure, stop the new service and disable its restart path. Copy its latest
   ACME state back to the old location; restore the retained exact original
   container/definition and network, then its original restart policy. Restore
   only the original server proxy JSON if abandoning independent ownership.
   Never restore the full Coolify DB or old application data.
6. Exercise this rollback deliberately, re-adopt, restart independently and repeat
   acceptance. Leave the old proxy stopped with restart disabled as bounded
   rollback material. Verify one public listener and one ACME writer.

The normal encrypted recovery supplement already includes `/srv`. After adoption,
run the normal backup and independently retrieve/hash-check the adopted definition,
routes, DNS environment and current ACME state. The existing archive retention
boundary is at least 30 days with no automatic pruning. Temporary test listeners,
fixtures and their credentials are removed after acceptance; valid backups remain.

This procedure does not retire Coolify management, alter cleanup/monitoring duties,
remove static sites or authorize the later M4–M7 milestones. Record actual results
and limitations in a private Test Run; put post-merge receipts on the implementing
PR and its explicitly related issue.
