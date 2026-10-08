# Pods desktop download and updates

The public download and updater use `https://pods.openape.ai`. The relay reads a
separate, read-only release directory; it never publishes owner workspace data.
There is no automatic deployment or artifact upload during desktop packaging.

## Release readiness

Use an exact-source review based on
`apps/openape-pods/runtime-sources/distribution-review.json`. The current template
has pending licenses, signed boundaries, clean machine, real provider, real tenant
refresh, physical sleep/wake and OS/CPU matrix evidence. Supplementary reviewed
notices must exist with the matching hash. A signed-local build remains internal;
its `releaseReady: false` cannot enter this channel.

The verified pilot is Apple Silicon, Darwin 25.6.0 / macOS 26.6.2 (25G83).
macOS 14 is the Electron bundle minimum, not a broader execution promise.
Changing that matrix requires corresponding packaged boundary acceptance.

Version with the existing Changesets workflow, review/merge and build from clean
canonical main. Do not reuse or overwrite a published version. Run the normal
repository gates and packaged acceptance on the exact build. Provide the existing
Developer ID identity, notary keychain profile, `OPENAPE_PODS_RELEASE_REVIEW` and
an English `OPENAPE_PODS_RELEASE_NOTES` summary through the normal environment.
Never put signing credentials in Git or the release directory.

```sh
pnpm --filter @openape/pods build
pnpm --filter @openape/pods package:signed
pnpm --filter @openape/pods test:distribution
```

Packaging generates a stapled DMG, a ZIP containing the notarized/stapled app,
SHA256SUMS and `release.json` in `apps/openape-pods/release/distribution`.
Only a fully approved signed build emits the public manifest. Artifact hashes
are computed after signing/stapling, and startup removes stale public metadata.
Retain the review, source SHA, lock hash, release notes and native test receipt.

## Provision and deploy the website

Before deploying the updated `compose/chatty.yml`, create
`/home/openape/projects/openape-pods-relay/shared/releases` on the configured
`chatty.delta-mind.at` SSH host. Use the existing service owner 999:988 and mode
0755. The Compose mount has `create_host_path: false`, is read-only inside the
container, and sets `NUXT_PODS_RELEASE_DIRECTORY=/releases`. It is separate from
`shared/data`; never stage owner files there.

Back up the installed Traefik file outside its watched directory, then atomically
install the reviewed `compose/traefik/pods-idp.yml`. Its higher-priority relay
route adds only `/api/releases/current`, `/download/mac` and the stable update
prefix; existing provider discovery, authorization and keys keep their routes.

Run `pnpm check:ci`, inspect `pnpm deploy:image pods-relay --dry-run`, then use
the established tested-image deployment from clean canonical main. Without a
channel pointer, the page shows the unavailable state and the feed returns 404.
This is expected, not a completed public release.

## Promote one complete release

Upload the exact packaging output into a private staging directory. On the host,
run the publisher from the matching checkout with its frozen dependencies and
built `@openape/pods-protocol` package:

```sh
node apps/openape-pods/scripts/publish-release.mjs STAGING_DIRECTORY /home/openape/projects/openape-pods-relay/shared/releases
```

The publisher validates provenance, filenames, sizes and SHA-256/SHA-512, holds a
single-writer directory lock, installs both archives plus their manifest under
`releases/VERSION/`, and atomically replaces `stable.json` last. Identical retries
recover after an interrupted pointer promotion; changed metadata/artifacts for
the same version and channel downgrades are refused. Never delete `.publishing`
until its original publisher is confirmed stopped. Inspect incomplete immutable
version directories instead of replacing them in place.

Verify the external `/api/releases/current`, `/download/mac`,
`/updates/stable/darwin-arm64/latest-mac.yml`, and
`/updates/stable/darwin-arm64/release.json`. Download both exact immutable
artifacts, compare their hashes and verify a byte-range response. Channel metadata
is no-store; versioned archives are immutable. The website and desktop must report
the same promoted version. Publish the receipts and inspected screenshots under
Test Runs.

## Native acceptance and recovery

Use an isolated profile and signed N and N+1 builds. Demonstrate normal quit after
download without installation, then explicit installation with backup before
native staging and one successful restart. Check Pods, schedules, selected
profile, encrypted secrets and runtime identity. Exercise offline, corrupt,
busy-worker, external-MCP and backup-failure refusals. An isolated native fixture
proves the updater lifecycle only; it does not replace the full product gates.

Backups use Electron's original filesystem API so `app.asar` is copied as its
exact signed archive bytes. A failure before native handoff releases the worker
fence. After native handoff, a failure requires quitting and reopening Pods;
the workspace stays paused to prevent writes during a possible replacement.

Install a quarantined DMG on the target MacBook with a fresh profile, pass
Gatekeeper and sign in independently. Confirm the actual OS/CPU matrix, provider
refresh and physical sleep/wake. Do not duplicate the existing Mac's identity or
schedules to make this test pass.

To withdraw a bad channel, remove its small `stable.json` pointer from service
and retain the artifacts/evidence. Operators can atomically restore a previously
reviewed pointer for new installations; installed newer apps refuse downgrades.
Never overwrite immutable artifacts or automatically restore a migrated database.
Restore a paired app/profile only after reconciling external effects and sessions;
retain the original Keychain and the failed profile for diagnosis.
