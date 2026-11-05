# Independent Chatty operational duties

Current state: M4 transferred the operational duties
([issue 1556](https://repos.openape.ai/patrick/monorepo/issues/1556)), M5 stopped
the five Coolify management containers and M6 gave every workload one
definition. Start with [Operating Chatty without Coolify](#operating-chatty-without-coolify-m7);
the M4 wording below describes how the duties were transferred.

Before and after every infrastructure change, and at intermediate checkpoints,
verify the separate `docpit.crm.delta-mind.at` CRM using normal system/VPN DNS,
trusted TLS, existing login, state, deferred details and bounded searches. Stop
progression on a regression. Forced-IP probes cannot satisfy this gate.

## Ownership and installation

Reviewed source is in `scripts/operations/`. Install Python helpers root-owned,
0755 under `/usr/local/libexec/`; configuration is root-owned, 0600 under
`/etc/openape-operations/`. Never commit production configuration or credentials.
Preserve exact original files/settings in a private recovery directory before
installation. Keep the current proxy, firewall and per-namespace MPTCP settings.

| Duty | Single scheduler/owner | Contract |
| --- | --- | --- |
| Database/file recovery | Existing `openape-backup.timer` | Existing tar and encrypted Restic stages; no pruning |
| Image/build cache | `openape-cleanup.timer` | Daily, explicit IDs, seven-day age, ten objects/1 GiB maximum |
| Local workload health | `openape-health.timer` | Every minute; Docker/systemd, disk, backup age, MPTCP |
| External availability | Mac mini LaunchAgent `ai.openape.chatty-health` | Every five minutes; normal HTTPS and fresh host receipt |
| Reports checkpoint | Patrick/operator | Weekly review, before schema changes, measured replay/sequence triggers |
| Mail certificate renewal, runner cache, CI image warming | Existing specific timers | Preserve their independent scope and the CI pause |

The external checker is independent of Chatty. It stores private local state and
transition history, and invokes only local macOS notifications. It does not send
mail or third-party messages. Execution of `osascript` proves notification API
submission, not that a person read the notification. The Mac must remain awake,
online and logged in; no redundant off-Mac alert delivery is claimed.

The existing Monitor service runs on Chatty and sends mail on transitions. Do
not use it to simulate a host outage or silently change its recipients/settings.

## Coolify writer fence

Inspect the exact installed source before changing flags. Current Coolify 4.1.3
supports `SCHEDULER_ENABLED=false` in its existing `.env`: the s6
`scheduler-worker` run script then sleeps instead of starting `schedule:work`.
Update the host file **in place** to preserve its inode. Verify the actual container
bind: a read-only stale inode can still expose the original bytes. In that case,
leave the correct host file for the next container creation and stop only the
current scheduler worker with `docker exec -u 0 coolify /command/s6-svc -d
/run/service/scheduler-worker`. Verify it is down and no scheduled job remains;
do not restart it against a stale bind. No management container restart is required.

Also preserve and set the narrow guards: instance auto-update/API/MCP off;
server `force_disabled=true`; metrics and Sentinel API scheduling off; application
auto-deploy and preview deployment flags off; expire the obsolete preview token.
Keep proxy `type=NONE` and `force_stop=true`. Do not erase tokens, app records,
preview history, data or credentials. Inspect pending/reserved queues before
handoff and verify no external writer job remains. Never invoke test notification
jobs or broad cache-clear/queue-delete commands.

The `is_sentinel_enabled` flag alone is insufficient: `isSentinelEnabled()` also
returns true when metrics are enabled, and its scheduled job can restart Sentinel
without checking `force_disabled`. Both settings and the scheduler fence matter.
The existing Sentinel container continues running during M4. Its controller checks
`isFunctional()` before accepting telemetry; `force_disabled=true` prevents
telemetry from enqueueing a second health/proxy writer. Verify this guard in the
installed source and confirm pending/reserved/delayed queues are empty.

The obsolete Forgejo deployment-preview workflow is removed. Its retained
`preview-dispatch.mjs` entry point exits 2 before builds, credentials or network
access. The active **file review** service at `preview.openape.ai`, its systemd
unit and API remain in service. Inspect webhook consumers and deployment queues;
a missing access log is not proof of no historical consumer.

## Backup lifecycle

Both existing backup stages call `coolify_lifecycle.capture`. Without a policy,
state defaults to `active`; failure of the real `pg_dump` is fatal. Production
was active throughout M4 and has been `retired` since M5.

A future, separately approved retirement may use this root-private policy:

```json
{"state":"retired","archive":"/private/final-coolify.sql","sha256":"FULL_SHA256","receipt":"/private/verified-archive.json"}
```

The independently verified receipt must bind `archiveSha256`, `restoredSha256`,
`restoreCheck: "passed"`, a full Restic `snapshot`, `verifiedAt` and
`independentLocation`. Capture verifies permissions, bytes and dump completion;
it never tries a running DB in retired state. A missing receipt or changed
archive fails. Producing that receipt requires actual off-host retrieval and
SQL restoration; writing a JSON assertion is not archival acceptance.

The retirement archive is not created or selected merely because the DB is
missing. No SQL is imported into production during backup or configuration
rollback. Keep all valid archives/snapshots at least 30 days, with no automatic
pruning. The encrypted supplement also exports explicitly protected rollback
image IDs from the cleanup policy, not only images attached to current containers.

## Bounded cleanup

`cleanup.json` contains a nonempty `protectedImages` array of exact image IDs.
Seed it from the verified recovery inventory and current image inventory; add
new rollback IDs before any deployment retires their containers. All existing
container image IDs are additionally protected at each run. Missing protected
images fail closed. Tagged images and repository digests are never candidates.

Run `/usr/bin/python3 /usr/local/libexec/bounded_cleanup.py` for a dry run;
`--apply` uses the same selection and rechecks before each deletion. The helper
uses one lock, no force image removal, and explicit cache-ID/age filters. It never
prunes containers, networks, volumes, registry blobs or backup objects. Receipts
name every selected ID and declared size. Layer sharing can reduce actual bytes
reclaimed. A zero-candidate normal run and repeat are valid no-op results.

## Proxy rollback when the old container is absent

The November 4 M4 baseline found the old `coolify-proxy` container absent while
all remaining identities/start times matched M3. Its removal actor was not
established. Do not depend on `docker start coolify-proxy` alone.

`edge_rollback.py` validates the saved original definition and exact image,
generates a protected Compose definition with persistent MPTCP0, and supports
reconstruction. Without `--apply`, it changes no running container. Validate the
same definition in a disposable isolated fixture before relying on it.

Actual rollback is a separately intentional edge action: first disable restart
and stop `openape-proxy`, carry its latest ACME stores to the original directory,
then bring up the reconstructed pinned original and wait for healthy before the
52-route probe. Only one ACME writer may run. Do not restore a whole Coolify DB,
older application data or a historical Reports authority/journal. M4 does not
repeat the already accepted public M3 cutover merely to test reconstruction.

## Reports checkpoint rotation

The ordinary nightly backup does not advance the external authority checkpoint.
Patrick/operator reviews the current `reports-recovery.mjs status` weekly and
before every schema change. Rotate when replay exceeds 15 measured minutes or
the chain exceeds 10,000 transactions; these conservative operating triggers
reserve time within the provisional four-hour core recovery objective.

1. Pass CRM and protected Reports read baselines. Preserve the exact running
   image, config and restart policy; acquire an exclusive maintenance lock and
   confirm no ordinary backup capture is active.
2. Disable the Reports restart path and stop its single writer, including the
   retention worker. Do not run another writer or disable authority enforcement.
3. Capture the frozen current database into the existing encrypted off-host
   Restic repository. Keep the full snapshot ID and absolute snapshot path.
4. Run the reviewed `checkpoint` command described in
   [independent Reports recovery](reports-independent-recovery.md), with
   `--writers-frozen`, the existing protected config and Restic wrapper. The CLI
   retrieves and fully compares the checkpoint before conditionally moving the
   head. Mount trusted CA roots; never bypass TLS verification.
5. Verify current head/local status, resume the **same** authority-aware image
   and restart policy, then verify normal private/refused reads and CRM.

Do not prune old checkpoints or transaction records. On an ambiguous failure,
keep Reports fenced and inspect the current authenticated head; reconcile or
recover to that authority before resuming. Never restore an older head/journal.
M4 assigns this procedure; it adds no automatic writer-stop timer. A future
schema migration needs its own compatible checkpoint and verification.

## Per-duty rollback

Pause the affected replacement timer or LaunchAgent and wait for its lock before
restoring its exact protected helper/config. For backup, restore only the prior
mandatory-active helpers while the DB remains running; no database restore.
For health, remove only the replacement checker and restore only that prior
monitoring duty. Cache deletion cannot be undone; retained image/data preservation
must already have passed before deletion.

Keep the global Coolify scheduler fenced during a partial rollback. If a specific
original Coolify duty must resume, explicitly schedule/invoke only its reviewed
job and restore only its required settings. Do not set `SCHEDULER_ENABLED=true`
or broadly re-enable API, updates, cleanup and proxy ownership together. A full
return to original ownership requires all replacement duties paused first and a
separately reviewed scope; it is not an automatic error handler.

## Retired management (M5)

M5 ([issue 1557](https://repos.openape.ai/patrick/monorepo/issues/1557)) stops
the five management containers but keeps them, their images and the
`coolify-db`/`coolify-redis` volumes for rollback. Each stopped name moves from
`containers` to `retired` in `health.json`. A retired container must exist, be
stopped and have restart policy `no`; health fails with `retired-missing`,
`retired-running` or `retired-restart` otherwise. A config without `retired`
behaves as before.

Order: set `--restart=no` on all five, stop `coolify-sentinel`, `coolify`,
`coolify-realtime`, take the quiescent final `pg_dump`, include it in a normal
backup snapshot, restore it independently off-host and write the receipt, switch
the backup lifecycle to `retired`, then stop `coolify-redis` and `coolify-db`.
Because no writer runs after the first phase, the stopped database equals the
archive.

Rollback is an owner decision and uses `docker start` of the retained
containers in reverse order. Never `compose up` from `/data/coolify/source`; an
upgrade attempt rewrote those files. Never import SQL.

1. `docker start coolify-db`, then `docker start coolify-redis`; set MPTCP 0 in both.
2. With only the database running, verify the guards before anything can act on them:

   ```sh
   docker exec coolify-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select is_auto_update_enabled,is_api_enabled from instance_settings" -c "select force_disabled,is_metrics_enabled,is_sentinel_enabled from server_settings" -c "select proxy from servers"'
   ```

   Expect auto-update and API off, `force_disabled` true and a proxy JSON with
   `"type":"NONE"` and `"force_stop":true`. Also confirm
   `SCHEDULER_ENABLED=false` in `/data/coolify/source/.env`.
3. Abort path: if any guard differs, run `docker stop coolify-redis coolify-db`,
   keep the retired lifecycle and health config unchanged and decide separately.
4. Keep a dated copy of the current `/etc/openape-operations/coolify-lifecycle.json`,
   then copy the protected `before/coolify-lifecycle.json` over it.
5. `docker start coolify-realtime`, `docker start coolify`, `docker start coolify-sentinel`;
   set MPTCP 0 in each. Within the first minute confirm the container sees
   `SCHEDULER_ENABLED=false` in `/var/www/html/.env`; otherwise stop `coolify`
   immediately. The edge stays independent; `coolify.openape.ai` stays 403
   through the deny router.

Then restore the original restart policies (`always` for `coolify`,
`coolify-db`, `coolify-redis` and `coolify-realtime`; `no` for
`coolify-sentinel`) and move the five names from `retired` back to `containers`
in the current `/etc/openape-operations/health.json`. Do not restore the pre-M5 `health.json`; later
milestones changed it.

## Container MPTCP mitigation

Container `net.mptcp.enabled` is per network namespace and resets to 1 when a
container is recreated unless its definition sets it. Every service in
`compose/chatty.yml` sets `sysctls: net.mptcp.enabled: "0"`
([issue 1558](https://repos.openape.ai/patrick/monorepo/issues/1558)); it takes
effect at each service's next deploy. Containers started from other host
definitions (static sites, the LLM stack and other host-defined apps) still need
`nsenter -t PID -n sysctl -w net.mptcp.enabled=0` after recreation until M6
gives them source-owned definitions. The IdP currently runs with the known
value 1 and `health.json` expects `"1"`; after its first deploy with this file,
health reports `mptcp:openape-prod-idp-1` and the expected value must be set to
`"0"`.

`compose/docs-site.yml` and `compose/gateway/docker-compose.yml` set the same
sysctl on every service and pin LiteLLM by digest
([issue 1559](https://repos.openape.ai/patrick/monorepo/issues/1559)); the
existing MPTCP test covers all three files.

## Host-defined workloads (M6)

Containers that are not built from this repository get exactly one root-private
definition at `/srv/workloads/NAME/compose.yaml`. The directory is never a served
content root. Each definition keeps the container name, the network, mounts and
ports. It pins the image to its current ID or digest and sets
`net.mptcp.enabled: "0"`. Secrets live only in a root-owned `0600` env file next
to the definition. A repeated `docker compose up -d` must recreate nothing.

Cutover per container: record the served content hash and stop the old container
before the new one starts, so two writers never share a data directory. Set the
old container to `restart=no`, rename it `NAME-before-m6` and add that name to
`retired` in `/etc/openape-operations/health.json`. Then run `compose up -d`.
Rollback: `docker compose -f /srv/workloads/NAME/compose.yaml down` (bind mounts
only; the external `coolify` network stays), `docker rename NAME-before-m6 NAME`,
`docker update --restart=unless-stopped NAME`, `docker start NAME`, then set
MPTCP 0 (the old container has no persistent sysctl). Remove `NAME-before-m6`
from `retired`, move `/srv/workloads/NAME` aside so a later `up -d` cannot
conflict, and regenerate the catalog with `python3 /srv/openape-operations/catalog.py`.

The recovery backup also captures every container's compose config files and
the `.env` in its compose working directory, so a definition outside the usual
roots is still restorable.

## Operating Chatty without Coolify (M7)

Coolify management is stopped and retained only for rollback
([issue 1560](https://repos.openape.ai/patrick/monorepo/issues/1560)). No
running workload depends on it. Each workload has exactly one definition:

| Kind | Definition | Deploy or change |
|---|---|---|
| OpenApe apps | `compose/chatty.yml`, installed as `/home/openape/prod/docker-compose.yml` | `pnpm run deploy:image <target>`; rollback through `<APP>_TAG_PREV` |
| Docs site | `compose/docs-site.yml` | `pnpm run deploy:docs-site` |
| LLM gateway | `compose/gateway/docker-compose.yml` | copy to the host project directory, then `docker compose up -d` |
| Sites from other repositories | their `compose/chatty*.yml` | their `scripts/deploy-image.mjs` |
| Host-defined workloads | `/srv/workloads/NAME/compose.yaml` (root `0600`) | `docker compose -f … up -d`; see [Host-defined workloads (M6)](#host-defined-workloads-m6) |
| Edge | `/srv/openape-proxy/compose.yaml` and `dynamic/*.yml` | [Independent Traefik edge](independent-edge.md) |
| Host services | systemd units | `systemctl restart UNIT` |

The root-private catalog `/srv/openape-operations/catalog.md` lists every
workload with its definition, source, image, data, routes and start, restart
and rollback commands, plus an operator quick start. Health is configured in
`/etc/openape-operations/health.json` and checked every minute; the independent
Mac checker alarms on transitions. Backups, off-host restore, cleanup and the
retired-management rollback follow the sections above.

The Docker network named `coolify` and its gateway `10.0.1.1` are load-bearing.
Traefik reaches containers by name on that network, and every host-port backend
is reached through `10.0.1.1`: route URLs, host port bindings and firewall rules
use `10.0.1.0/24`. The name is historical; the network does not depend on the
stopped management stack. Never remove it together with the Coolify archive.
Renaming it is a separate migration that recreates every attached container.

Rollback rules:

- Tag rollback: the `<APP>_TAG` variable names come from the compose file, and
  every `deploy:image` writes the previously live tag to `<APP>_TAG_PREV`. That
  is one level of history: after a retry or a repeated deploy it may not be the
  last good image. Tags are `prod-<commit>`, so a known-good earlier commit can
  be chosen instead; compose pulls a missing tag from the registry. If the
  broken release may have changed data, take an on-demand backup first. Keep a
  dated copy of `.env`, set `<APP>_TAG`, and run
  `docker compose --env-file .env -f docker-compose.yml up -d SERVICE` in the
  host directory. `compose/chatty.yml` sets `name: openape-prod`, so this
  targets the existing project. A deploy also syncs `docker-compose.yml`; if
  that file changed, restore it from the previous commit. Data migrations are
  not undone.
- After every `docker start` or recreation, check MPTCP. A container without a
  persistent sysctl starts with 1: `nsenter -t PID -n sysctl -w net.mptcp.enabled=0`.
- Edit only the current config `/etc/openape-operations/health.json`
  (the receipt in `/var/lib/openape-operations/` is output): write a `.new` file with mode `0600`
  and rename it over the original. Move just the affected names; never restore
  an older full copy.
- Restore from backup: snapshots contain plain host paths, and an on-demand
  backup uploads immediately. Pick a snapshot taken after the file's last
  change and compare the SHA256 before using it.
- If a rollback step fails, stop. Keep old and new containers and all files,
  and decide separately.
- Run the CRM continuity gate before and after every infrastructure change,
  including a plain restart.

Every rollback artifact from M5 and M6 is retained for at least 30 days after
2026-11-05. Deleting any of them is a separate explicit owner decision after a
dependency and restore check; reaching the date deletes nothing.
