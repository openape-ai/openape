# Pods mobile release readiness (M6)

Companion to [pods-mobile.md](pods-mobile.md), the [protocol contract](../architecture/pods-mobile-protocol.md) and [issue 1362](https://repos.openape.ai/patrick/monorepo/issues/1362). Each item states what is implemented, how it is verified and what remains an owner or Apple decision. Build readiness is not App Review approval.

## Compatibility and rollback matrix

| Case | Behavior | Verified by |
| --- | --- | --- |
| New relay, older desktop or phone | Capabilities are intersected; the peer uses only the commands, queries and content modes both sides list; minor is the smaller of the two. | `packages/pods-protocol/test/protocol.test.ts` ("negotiates only mutually supported operations") |
| Older relay, newer client | Same intersection; a new operation the relay does not list is refused before use and the phone shows the desktop handoff instead of a failure. | protocol tests; `RelayClient` 426 "Update the desktop application to use this operation." |
| Unsupported major or missing `encrypted-v1` | `unsupported_version` / `encryption_required` (426); no plaintext fallback exists. | protocol tests ("rejects capability expansion, unreviewed runs and unknown versions") |
| Relay rollback | `pnpm deploy:image pods-relay` keeps the previous tag and restores it when the health gate fails; the relay database is additive (push and poll tables are optional for older binaries). | deployment tests, [pods-mobile.md](pods-mobile.md) |
| Relay data restore | Only from a reviewed recovery point; never over newer revocations. Buffered content expires in 24 hours, receipts/audit in 30 days, so a restore loses at most that window and never resurrects revoked access. | `store.test.ts` retention cases |
| Shipped iOS binary | Cannot be downgraded remotely; pause the TestFlight build or submit a compatible newer build. Server capability flags remove individual operations without hiding committed outcomes. | capability negotiation |

Supported window: the current release and the previous one for 90 days (plan decision 3). `IPHONEOS_DEPLOYMENT_TARGET = 18.0`.

## Limits and monitoring

- Per IP: 600 API requests and 60 login requests per minute (`service.ts`), `Retry-After` on 429/503.
- Per runtime: 100 pending commands (`runtime_queue_full`), 30-second dispatch leases, 64 KiB frames with authenticated multipart for larger content.
- Per device and runtime: 1000 buffered events or 32 MiB (`replay_buffer_full`); 1000 concurrent login flows.
- Health: `/api/mobile/v1/health` reports `enabled`, `workspaceEnabled` and `notifications`; the deployment gate requires `service: openape-pods-relay`.
- Audit: IDs, actions and times only (`registered`, `revoked`, `push_*`, …). No request or body logging. Content never reaches logs; the relay store test asserts the database holds no readable content.

## Privacy and disclosures

The per-party visibility table in the protocol contract is the source for App Store privacy labels and the in-app texts (desktop Mobile access dialog, native Devices sheet). Data linked to the user: account identifier (verified issuer and subject), device and runtime identifiers, diagnostics-free audit metadata. Not collected by the relay: messages, scripts, results, files, credentials. Notifications are content-free. Retention: 24 hours (buffered content), 30 days (receipts and audit), device cache 7 days / 50 MiB, excluded from backups.

Encryption export: the app uses Apple CryptoKit (P-256 ECDH, HKDF-SHA256, AES-256-GCM, ECDSA) for the end-to-end envelope besides HTTPS. This is standard, publicly available cryptography; whether `ITSAppUsesNonExemptEncryption` can be answered with an exemption (mass-market self-classification) is the owner's declaration in App Store Connect, to be made with Apple's current questionnaire at submission. The classification facts are listed here so the declaration is accurate.

## Accessibility

SwiftUI system text styles throughout (Dynamic Type), icon-only buttons carry accessibility labels (`Refresh Pods`, `Refresh Pod`, `Send message`), the handoff box and review summaries are combined accessibility elements, safe areas and keyboard avoidance come from the system containers. Device-level VoiceOver, keyboard and large-text passes are part of the tester checklist in [pods-mobile.md](pods-mobile.md).

## App Review

- Classification risk (plan): the app is a native task client for the owner's own desktop, not screen mirroring. Request early feedback with the TestFlight build; if Apple applies §4.2.7, record the blocker in the plan and revisit distribution with the owner.
- Reviewer access: provide a reviewer-owned disposable desktop profile and relay owner allowlist entry, never the owner's production runtime. The fixture harness (`apps/openape-pods-ios/UITests/fixtures.mjs`) shows the exact setup a demo environment needs: disposable IdP identity, packaged desktop with a harmless installed CLI, pilot allowlist.
- Review notes must state the desktop dependency plainly: creation and execution require the paired desktop online; the phone reviews, approves at the identity provider and reads results.
- Support URL and privacy policy URL are owner-published documents; their content must match this document and the protocol contract.

## Owner decisions and actions before submission

1. Create the App Store Connect app record for `ai.openape.pods` (team `Q994DN23WB`) with Associated Domains and Push Notifications capabilities; request the APNs authentication key and deliver it through secrets.openape.ai.
2. Decide the encryption export declaration and the privacy labels from the facts above.
3. Publish privacy policy and support pages; provide the reviewer demo environment.
4. Run the tester checklist on physical iPhone and iPad with the TestFlight build, including poor network, IPv6-only and suspended-app cases, and record results through Test Runs.
5. Record the App Review outcome separately from build readiness.
