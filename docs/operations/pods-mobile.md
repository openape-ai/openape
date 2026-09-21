# Pods mobile rollout

This is the operational companion to [issue 1362](https://repos.openape.ai/patrick/monorepo/issues/1362) and the [approved plan](../../.claude/plans/2026-09-20-pods-native-mobile.md). The implementation remains opt-in. A healthy relay is not acceptance of the native creation/chat/authorized-run flow or permission to open public enrollment.

## Independent service

`pods-idp` remains on port 3027 with its existing database, signing keys and image. `pods-relay` uses port 3028, its own SQLite database, Node 24.15.0 and the packaging image `compose/pods-relay-package.Dockerfile`. It runs as the existing application UID/GID 999:988 with a read-only container filesystem; only its dedicated data mount and bounded temporary filesystem are writable. The relay cannot access the provider's data mount. The pre-push image smoke runs the built image with that user, a read-only root filesystem, a bounded writable `/tmp` and an enabled disposable SQLite database, and requires the exact `service` identity in the health response; a root-only smoke is not evidence that the production user can start the server.

The exact routing configuration is `compose/traefik/pods-idp.yml`. The new higher-priority router owns only `/api/mobile/v1/`, `/api/runtime/v1/`, `/mobile-auth/`, the Apple association and SP client metadata. Existing discovery, JWKS, authorization/token, agent provisioning and grant routes retain the provider service. On September 20, the existing SP metadata path returned 404; inspect it again before installing this router in case another workstream has added a client.

Prepare `/home/openape/projects/openape-pods-relay/shared/data` and its parent on the configured `chatty.delta-mind.at` host as owner 999:988 with mode 0700. Create only this new service's `shared/.env` with mode 0600 and these initial values:

```dotenv
NUXT_RELAY_ENABLED=false
NUXT_RELAY_ENROLLMENT=closed
NUXT_RELAY_OWNER_ALLOWLIST=[]
```

Compose fixes the public origin, database location and fixture mode. Never enable `NUXT_RELAY_FIXTURE` outside disposable loopback tests. No provider secret or Pod credential belongs in the relay environment.

## Deployment order

1. Review the native PR and exact source/target SHAs. Require the full unit, E2E and macOS layout checks for that source. Deploy only from a clean canonical-main checkout containing the accepted change.
2. Prepare the new service directory/environment. Back up the current Traefik configuration and inspect the existing provider discovery/JWKS/health responses before the routing change. Keep that backup outside the watched directory.
3. Install the reviewed Traefik file atomically. New mobile paths may return unavailable until the first relay starts; existing provider paths must still work. Do not replace other dynamic routing files.
4. Run `pnpm deploy:image pods-relay --dry-run`, then the normal tested-image deployment command `pnpm deploy:image pods-relay`. Its external gate checks `/api/mobile/v1/health` **and** `service: openape-pods-relay`, so the existing provider cannot satisfy the relay gate. A failed first deployment stops the new service; subsequent failures restore its previous image.
5. Verify provider `/api/health`, `/.well-known/openid-configuration` and `/.well-known/jwks.json` are unchanged. Verify mobile health reports `enabled: false`, native enrollment is unavailable, public registration remains blocked and the Apple association lists the intended team/bundle only.
6. For the approved isolated pilot, set `NUXT_RELAY_ENROLLMENT=pilot`, the exact issuer/subject allowlist and `NUXT_RELAY_ENABLED=true` in the new environment, then recreate only `pods-relay`. Prove unauthorized owners are refused. Do not use `public` as a temporary test shortcut.
7. Enable the accepted desktop build with `OPENAPE_PODS_REMOTE_ENABLED=1`. Register its existing owner, sign in on the native app and compare the matching code on both devices. Record the real end-to-end proof before widening enrollment or distributing an external TestFlight build.

The iOS application uses bundle `ai.openape.pods`, team `Q994DN23WB`, iOS/iPadOS 18 and both `applinks` and `webcredentials` association services. Signed Simulator login-layout checks do not establish the HTTPS authentication handoff on a physical device. Apple distribution signing, upload, beta review and store review remain separate gates.

## Native validation toolchain

The iOS workspace selects `/Applications/Xcode.app/Contents/Developer` for its Swift and Simulator checks. The existing macOS CI runner deliberately defaults to Command Line Tools; that environment does not supply the Swift Testing module. Keep this selection scoped to iOS commands and do not change the runner launch configuration or other workspaces.

## Recovery and retention

For an incident, first set relay enrollment closed and the service disabled, recreate only `pods-relay`, and disable desktop Mobile access. Keep provider routes available. Removing the relay router restores the original provider routing; it does not restore any mobile session. Local Pods continue to use their existing execution/grant system.

Do not restore an old full relay database over a newer revocation history. Buffered encrypted content expires after 24 hours; receipts/audit metadata after 30 days. The first release has no cloud content backup. Losing relay state requires fresh registration and explicit pairing; original desktop Pods and identities remain local. Inspect database/schema compatibility before changing the image tag.

Desktop schema 22 cannot be opened by older desktop binaries. Keep a pre-upgrade local backup for binary rollback. Restoring a backup pauses execution, removes remote registration/pairings/outbox and pending program reviews, withdraws program offers and marks in-flight commands unknown. Owner/agent identity references remain unchanged, but credentials are intentionally excluded from backups: recovered Pods require explicit desktop credential recovery and cannot silently provision a replacement identity.

Never replay an uncertain operation under a new UUID to make a demo succeed. Reconcile the original operation/run first. Device or runtime revocation prevents subsequent commands; cancelling an already authorized run uses its separate run control.
