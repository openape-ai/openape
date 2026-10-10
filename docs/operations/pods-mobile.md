# Pods relay and phone inbox

The installed inbox web app at `/inbox/` on `pods.openape.ai` is the only phone surface for OpenApe Pods. The relay carries desktop registration, the central browser workspace and the account inbox. The overall model: [Pods model](../../apps/openape-pods/docs/model.md).

## Independent service

`pods-idp` remains on port 3027 with its existing database, signing keys and image. `pods-relay` uses port 3028, its own SQLite databases, Node 24.15.0 and the packaging image `compose/pods-relay-package.Dockerfile`. It runs as the application UID/GID 999:988 with a read-only container filesystem; only its dedicated data mount and bounded temporary filesystem are writable. The relay cannot access the provider's data mount. The pre-push image smoke runs the built image with that user, a read-only root filesystem, a bounded writable `/tmp` and an enabled disposable SQLite database, and requires the exact `service` identity in the health response.

The routing configuration is `compose/traefik/pods-idp.yml`. The higher-priority relay router owns `/api/mobile/v1/` (desktop registration session endpoints and the external health check), `/api/runtime/v1/`, `/mobile-auth/` (the browser leg of desktop registration), the workspace, inbox and update paths and the SP client metadata. These path names predate the removal and stay unchanged because installed desktop builds call them. The router still lists `/.well-known/apple-app-site-association`; the relay no longer serves it.

The service environment `/home/openape/projects/openape-pods-relay/shared/.env` (mode 0600) controls desktop registration with `NUXT_RELAY_ENABLED`, `NUXT_RELAY_ENROLLMENT` (`closed`, `pilot` or `public`) and, for `pilot`, the exact issuer/subject list in `NUXT_RELAY_OWNER_ALLOWLIST`. Compose fixes the public origin, database locations and fixture mode. Never enable `NUXT_RELAY_FIXTURE` outside disposable loopback tests. No provider secret or Pod credential belongs in the relay environment. `NUXT_RELAY_APNS_*`, `NUXT_RELAY_APPLE_TEAM` and `NUXT_RELAY_APPLE_BUNDLE` are no longer read; remove them from the environment.

## Deployment

Run `pnpm deploy:image pods-relay --dry-run`, then `pnpm deploy:image pods-relay`. Its external gate checks `/api/mobile/v1/health` **and** `service: openape-pods-relay`, so the provider cannot satisfy the relay gate. A failed deployment restores the previous image. Verify provider `/api/health`, `/.well-known/openid-configuration` and `/.well-known/jwks.json` afterwards.

## Desktop registration and recovery

The desktop registers once per profile through the central workspace (Register this desktop): `session/begin`, the owner's browser login through `/mobile-auth/start` and `/mobile-auth/callback`, then `session/exchange`. Its signed runtime session (`session/refresh`, request proofs on every call) carries `/api/runtime/v1/workspace`, `/api/runtime/v1/inbox` and `/api/runtime/v1/inbox/decisions`. Only `runtime` registrations can authenticate; registrations of the removed native app remain in the relay database without access.

Before installing a desktop update, compare its workspace format, network tables and schema with the deployed relay. Deploy and verify the compatible relay first; then back up the stopped desktop profile and install the signed app. A healthy relay alone does not prove compatibility with the desktop publication contract.

A rotated refresh token replay revokes its session family, not a still-valid runtime registration. Use Register this desktop and the normal owner browser login to recover the same runtime ID, keys and generation. Reauthentication keeps local adoption receipts, publication journals and effect records; it does not replay uncertain work. Previous revoked sessions stay revoked.

A revoked registration, different owner/generation, missing local registration or lost relay registration needs explicit recovery. Registration must never silently create a new identity or change the generation to hide that conflict. Do not restore stale registration tokens from an old profile over newer sessions. After reauthentication, verify the unchanged runtime/generation and central receipt reconciliation before resuming operations; preserve unknown outcomes for their existing review flow.

## Recovery and retention

For an incident, set relay enrollment closed and the service disabled, then recreate only `pods-relay`. Keep provider routes available. Local Pods continue to use their existing execution and grant system.

Do not restore an old relay database over a newer revocation history. Sessions expire after 7 idle days or 30 days; the relay keeps no audit log. Losing relay state requires a fresh desktop registration; original desktop Pods and identities remain local. Inspect database/schema compatibility before changing the image tag.

Since the baseline schema 46 (issue 1455, M8) the desktop keeps only `remote_registration` and `remote_pods`; the mobile tables are gone. Restoring a backup (schema 45 or 46) pauses execution, removes the desktop registration and marks in-flight work unknown. Owner/agent identity references remain unchanged, but credentials are intentionally excluded from backups: recovered Pods require explicit desktop credential recovery and cannot silently provision a replacement identity.

## Installed inbox app (M4, issue 1446)

The [mobile inbox plan](../../.claude/plans/2026-10-07-pods-ios-inbox/plan.json) ships an installed web app at `/inbox/` on the relay; it replaced the M0 prototype (its API, `NUXT_INBOX_PROTOTYPE_*` flags and push dispatcher are gone; the old `inbox-prototype.sqlite` file can be deleted on the host). Routes: `/inbox/` (Decisions with completed history), `/inbox/messages` (Notifications, `?archived=1` for the archive), `/inbox/item/<id>`, `/inbox/settings`. It uses only the M1/M2 owner API below and needs `NUXT_INBOX_ENABLED=true`; the Traefik router needs the `/inbox` paths from `compose/traefik/pods-idp.yml`.

- Sync: the phone pulls `changes?after=` on start, on return to the foreground, every 30 seconds while visible, on reconnect and on Refresh. Server state is authoritative; push is never needed for correctness.
- Offline: one `localStorage` copy per browser (`pods-inbox-cache-v1`) bound to the signed-in account. It is discarded on sign-in, sign-out, any 401 (expired or revoked device) and when another account starts. Offline views are read-only with the last sync time and account; decisions are never queued or replayed.
- Decisions send the digest the phone displayed and a request ID. A send with unknown outcome can only be resent unchanged by the owner; `accepted`/`started` are shown as not applied until the operation reports `applied`. IdP/Secrets decisions open their verified HTTPS link; steps without options or link say they need the Mac.
- Service worker `/inbox/sw.js` (scope `/inbox/`) caches only the public app shell, icons and hashed `/pods-assets/` files, never API responses. A new version installs and waits; the app offers "Load now" after its running decisions settled. Bump `version` in `sw.js` whenever the worker changes.
- Push (M5): Settings → Turn on notifications asks for permission from that tap, subscribes with `NUXT_INBOX_VAPID_PUBLIC_KEY` and registers the endpoint with `push/subscribe`; the app re-registers an existing subscription on each start. On iOS the same permission enables the count on the app icon. Every 5 seconds the relay sends each due outbox entry to all subscriptions of the account (`web-push`, `NUXT_INBOX_VAPID_PRIVATE_KEY`, subject = relay origin) as a Declarative Web Push (`web_push: 8030`, `mutable`) with the item title, `navigate` to `/inbox/item/<id>`, `tag` = item ID and `app_badge` = the account's badge count; the service worker shows it and refreshes the badge. `sent` means a push service accepted it, not that the phone displayed it. 404/410 remove the subscription; other failures retry after 30 s, 2 min, 10 min and 1 h, then `failed`. Without subscription the entry ends as `no_subscription`; a deleted item or resolved decision sends nothing. `NUXT_INBOX_PUSH_ENABLED=false` stops dispatch alone; the inbox and sync keep working.
- Rollback: deploy the previous relay image. Server inbox data is untouched; an older worker version is replaced by the next activation, and private data never lived in its caches.

## Account inbox service (M1, issue 1446)

`NUXT_INBOX_ENABLED=true` enables the durable owner inbox in its own database (`NUXT_INBOX_DATABASE`, compose: `/data/inbox.sqlite`). It is service-readable by design and never described as end-to-end encrypted.

- Owner API `/inbox/api/v1/`: `session`, `items` (cursor `before`, `kind`, `archived=1`), `items/:id` (GET, PATCH `read`/`archived`/`deleted`), `items/:id/decide`, `operations/:id`, `changes?after=` (sync cursor including tombstones), `devices`, `devices/:id/revoke`, `logout`, `push/subscribe`, `push/unsubscribe`. Non-GET requests require the relay Origin.
- Sessions: only a DDISA sign-in started from the inbox (validated `/inbox/` return path) registers an inbox device and sets the `pods-inbox` cookie (path `/` so sign-in and workspace logout can revoke it, 30 days absolute). A workspace session alone never opens the inbox. Every request re-checks the device; revocation, inbox logout, workspace logout or any other sign-in in the same browser revokes it, deletes its push subscriptions and refuses the cookie with `session_revoked`.
- Runtime publication `POST /api/runtime/v1/inbox` uses the signed runtime session; the owner comes from the runtime registration. Items are idempotent per runtime and `eventId` (identical retry 200, changed content 409 `inbox_event_conflict`), bounded to 64 KiB bodies and five HTTPS links, and commit together with a push-outbox entry.
- Retention: messages and resolved items become tombstones after 90 days and are purged 30 days later; open decisions stay. More than 10,000 live items per owner returns 507 `inbox_quota` instead of dropping content. Database backups keep deleted content for their own retention period.
- Rollback: `NUXT_INBOX_ENABLED=false`; the additive database stays.

## Pod notifications (M3, issue 1446)

Pod scripts call `await context.notify({ key, title, body, links? })`. There is no recipient, bot or chat ID: the Pod owner's account inbox always receives it. The worker validates the same bounds as the inbox (title ≤ 300 characters, body ≤ 64 KiB, ≤ 5 HTTPS links, ≤ 20 per run) and stores it in `inbox_outbox` (schema 41) under the event ID `<podId>:<key>`. The same key with the same content is queued once, also across retried runs; changed content fails the call.

The desktop main process delivers due entries every 15 seconds with the signed runtime session to `POST /api/runtime/v1/inbox`. A receipt marks the entry delivered. 400/409/413 refusals are final and visible in the outbox status. Every other failure (offline, 401 before token refresh, 503, 507 quota) retries the identical event with backoff (30 seconds to 1 hour); the inbox deduplicates it, so an uncertain delivery never creates a second message. Delivery requires a desktop registered with the relay for the same owner. `queued` means stored durably, not read. Existing Telegram scripts are unchanged; switching one producer is M7.
