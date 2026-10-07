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

## Notifications (APNs)

The relay sends content-free APNs hints only when `NUXT_RELAY_APNS_ENABLED=true` and an APNs authentication key is configured. Request the `.p8` key, its key ID and the team ID through secrets.openape.ai, never through chat or the plan. Environment:

```dotenv
NUXT_RELAY_APNS_ENABLED=false
NUXT_RELAY_APNS_KEY_ID=
NUXT_RELAY_APNS_KEY=-----BEGIN PRIVATE KEY-----...-----END PRIVATE KEY-----
```

`NUXT_RELAY_APPLE_TEAM`/`NUXT_RELAY_APPLE_BUNDLE` already name the topic (`ai.openape.pods`). Development builds register `development` tokens and are sent through `api.sandbox.push.apple.com`; TestFlight and App Store builds use `production`. Health reports `notifications: true` when the sender is enabled. Disable notifications independently of the relay by setting the flag to `false` and recreating `pods-relay`; registrations survive and resume when it is re-enabled. Audit rows `push_registered`, `push_sent`, `push_failed`, `push_unregistered` and `push_token_unregistered` carry IDs and times only.

## TestFlight and distribution

`pnpm --filter @openape/pods-ios archive` archives the Release build for `generic/platform=iOS` with automatic signing for team `Q994DN23WB`, exports it with `ExportOptions.plist` (`app-store-connect`) and writes `.artifacts/distribution/receipt-<build>.json` with the archived head. It uploads only when `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH` and `PODS_UPLOAD=1` are set; otherwise the owner uploads the exported `.ipa` through Xcode Organizer or Transporter. App Store Connect app record, bundle identifier capabilities (Associated Domains, Push Notifications), Beta App Review and tester groups are owner actions in the Apple workflow. Desktop Developer ID/notarization assets do not establish iOS signing.

Tester checklist per build (record build number, relay image, desktop version and device OS):

1. Sign in with the pilot owner, pair the desktop with the matching code, open an existing Pod and confirm the transcript and run history match the desktop.
2. Lock and unlock the device: the session survives, cached content stays readable while offline ("Offline · cached content"), and a run cannot be started offline.
3. Enable notifications in Devices, send a message from the desktop while the app is in the background, and confirm the notification names no content and opens the Pod; confirm the same update appears without a notification when the app is foregrounded.
4. Start a run from the phone, approve it at the identity provider, and confirm the identical result on both devices; cancel a running run and confirm it ends only after the desktop reports it.
5. Revoke the device from the desktop and from another device; confirm the refusal text and that content already shown is still visible until sign-out.
6. Sign out: keys, cache and drafts are gone; signing in again requires pairing.

## Desktop compatibility and identity-preserving recovery

Before installing a desktop update, compare its workspace format, network tables
and schema with the deployed relay. Deploy and verify the compatible relay first;
then back up the stopped desktop profile and install the signed app. A healthy
relay alone does not prove compatibility with the desktop publication contract.

A rotated refresh token replay revokes its session family, not a still-valid runtime
registration. Use Register desktop and the normal owner browser login to recover
the same runtime ID, signing/agreement keys and generation. Reauthentication keeps
pairings, local adoption receipts, publication journals and effect records; it does
not replay uncertain work. Previous revoked sessions stay revoked.

A revoked device, different owner/generation, missing local registration or lost
relay registration needs explicit recovery. Registration must never silently create
a new identity or rotate the generation to hide that conflict. Do not restore stale
registration tokens from an old profile over newer sessions. After reauthentication,
verify the unchanged runtime/generation and central receipt reconciliation before
resuming operations; preserve unknown outcomes for their existing review flow.

## Native validation toolchain

The iOS workspace selects `/Applications/Xcode.app/Contents/Developer` for its Swift and Simulator checks. The existing macOS CI runner deliberately defaults to Command Line Tools; that environment does not supply the Swift Testing module. Keep this selection scoped to iOS commands and do not change the runner launch configuration or other workspaces.

## Recovery and retention

For an incident, first set relay enrollment closed and the service disabled, recreate only `pods-relay`, and disable desktop Mobile access. Keep provider routes available. Removing the relay router restores the original provider routing; it does not restore any mobile session. Local Pods continue to use their existing execution/grant system.

Do not restore an old full relay database over a newer revocation history. Buffered encrypted content expires after 24 hours; receipts/audit metadata after 30 days. The first release has no cloud content backup. Losing relay state requires fresh registration and explicit pairing; original desktop Pods and identities remain local. Inspect database/schema compatibility before changing the image tag.

Desktop schema 22 cannot be opened by older desktop binaries. Keep a pre-upgrade local backup for binary rollback. Restoring a backup pauses execution, removes remote registration/pairings/outbox and pending program reviews, withdraws program offers and marks in-flight commands unknown. Owner/agent identity references remain unchanged, but credentials are intentionally excluded from backups: recovered Pods require explicit desktop credential recovery and cannot silently provision a replacement identity.

Never replay an uncertain operation under a new UUID to make a demo succeed. Reconcile the original operation/run first. Device or runtime revocation prevents subsequent commands; cancelling an already authorized run uses its separate run control.

## Inbox PWA prototype (M0, issue 1446)

The [mobile inbox plan](../../.claude/plans/2026-10-07-pods-ios-inbox/plan.json) first proves an installed web app on the owner's iPhone. The disposable prototype lives at `/inbox/` on the relay: Decisions and Notifications tabs, synthetic items, standard Web Push and a push log. It reuses the workspace DDISA browser session (`pods-workspace` cookie); sign-in resumes only same-origin `/inbox` paths. Content is service-readable synthetic data, not real Pod decisions, and is never end-to-end encrypted. Its separate database keeps removal to one file.

```dotenv
NUXT_INBOX_PROTOTYPE_ENABLED=true
NUXT_INBOX_PROTOTYPE_DATABASE=/data/inbox-prototype.sqlite
NUXT_INBOX_VAPID_PUBLIC_KEY=
NUXT_INBOX_VAPID_PRIVATE_KEY=
```

Generate the VAPID pair on the host and write it straight into `shared/.env`; never copy the private key into chat, logs or plans. The Traefik router needs the `/inbox` paths from `compose/traefik/pods-idp.yml`. Each push is claimed once, persisted as an inbox item first and never retried; the service worker reports display (`shown`) and taps (`clicked`) with a per-push secret, and the item page reports `opened`. Disable with `NUXT_INBOX_PROTOTYPE_ENABLED=false`; rollback removes the database file and device subscriptions.

## Account inbox service (M1, issue 1446)

`NUXT_INBOX_ENABLED=true` enables the durable owner inbox in its own database (`NUXT_INBOX_DATABASE`, compose: `/data/inbox.sqlite`). It is service-readable by design and never described as end-to-end encrypted.

- Owner API `/inbox/api/v1/`: `session`, `items` (cursor `before`, `kind`, `archived=1`), `items/:id` (GET, PATCH `read`/`archived`/`deleted`), `changes?after=` (sync cursor including tombstones), `devices`, `devices/:id/revoke`, `logout`, `push/subscribe`, `push/unsubscribe`. Non-GET requests require the relay Origin.
- Sessions: only a DDISA sign-in started from the inbox (validated `/inbox/` return path) registers an inbox device and sets the `pods-inbox` cookie (path `/` so sign-in and workspace logout can revoke it, 30 days absolute). A workspace session alone never opens the inbox. Every request re-checks the device; revocation, inbox logout, workspace logout or any other sign-in in the same browser revokes it, deletes its push subscriptions and refuses the cookie with `session_revoked`.
- Runtime publication `POST /api/runtime/v1/inbox` uses the signed runtime session; the owner comes from the runtime registration. Items are idempotent per runtime and `eventId` (identical retry 200, changed content 409 `inbox_event_conflict`), bounded to 64 KiB bodies and five HTTPS links, and commit together with a push-outbox entry.
- Retention: messages and resolved items become tombstones after 90 days and are purged 30 days later; open decisions stay. More than 10,000 live items per owner returns 507 `inbox_quota` instead of dropping content. Database backups keep deleted content for their own retention period.
- Rollback: `NUXT_INBOX_ENABLED=false`; the additive database stays.
