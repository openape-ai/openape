# Dependency audit exceptions

## CVE-2026-85393 / GHSA-86w9-cpqp-85rv

Patrick explicitly approved ignoring this advisory on October 2, 2026 so the
approved Pods implementation can continue. It is assessed as not a blocker for the reviewed
Nuxt projects. Native tracking: https://repos.openape.ai/patrick/monorepo/issues/1418.

The advisory concerns node-forge RSA PKCS1v1.5 signature verification accepting
extra nested DigestAlgorithm elements. Installed Nuxt CLI 3.37.0 imports listhen
from development-server chunks. Installed listhen 1.10.0 uses Forge for local
certificate generation/signing and configured PEM/PFX parsing; source review
identified no call to the affected signature verifier. Production Nuxt packaging
copies the built Nitro `.output`, while Docs packaging serves `.output/public`
through Caddy. This describes inspected deployment sources, not a scan of every
currently deployed image.

The audit also flags the direct production dependency `@openape/proxy -> node-forge`.
The existing proxy CA implementation generates and signs local certificates;
its production code does not call Forge's signature verifier. The alternative
crypto-library replacement is preserved separately and is not required for this
exception. No runtime certificate identity or behavior changes accompany it.

`auditConfig.ignoreGhsas` suppresses the exact `GHSA-86w9-cpqp-85rv` advisory
(CVE-2026-85393) throughout this monorepo. The October 25 migration from the
CVE key preserves the existing approval and makes the policy compatible with
both repository pnpm 10 and the standalone Pod collector's pnpm 11;
pnpm does not limit this setting to individual dependency paths. It does not
ignore every node-forge advisory or lower the high-severity audit threshold.
Reassess if Forge signature verification is introduced, untrusted certificate
processing changes, the deployment starts shipping development tooling, or an
upstream release fixes the advisory. Other Nuxt projects should retain this
reasoning and verify their own usage rather than assuming all dev dependencies
are harmless. Remove the exception when the lockfile resolves a patched version
for every affected path. The repository exception does not suppress advisories
reported by downstream consumers of the published proxy package.

Sources:

- https://github.com/advisories/GHSA-86w9-cpqp-85rv
- https://github.com/nuxt/nuxt/security
- https://nuxt.com/docs/4.x/api/commands/dev
- https://nuxt.com/docs/4.x/getting-started/deployment

## GHSA-vfj7-8cjw-p6xm (braces)

Patrick explicitly approved ignoring this advisory on October 4, 2026 and entered
the `auditConfig.ignoreGhsas` entry himself so pushes and CI can continue. The
advisory reports stack exhaustion in `braces <= 3.0.3` when expanding deeply
nested brace patterns; 3.0.3 (May 2024) is the latest release and the advisory
lists no patched version, so no lockfile update can resolve it. The only path in
this monorepo is `apps/docs > @nuxt/content > micromatch > braces`: build-time
globbing of the repository's own documentation sources, never patterns supplied
by users or network peers. No production runtime package resolves `braces`.

The entry suppresses this exact advisory monorepo-wide; it does not lower the
high-severity threshold or ignore other `braces` or `micromatch` advisories.
Reassess if any production package starts depending on `braces` with untrusted
patterns, and remove the exception when a patched release exists and the
lockfile resolves it for the affected path.

Sources:

- https://github.com/advisories/GHSA-vfj7-8cjw-p6xm

## GHSA-mrhx-c7xc-m3w5 (zod 3 via @nuxt/content)

Patrick explicitly approved ignoring this advisory on October 24, 2026 so the
high-severity audit gate can pass after the same-day dependency update round.
The advisory reports memory exhaustion in `zod < 4.6.6` while validating
oversized constrained collections; the only patched line is 4.6.6, and no
patched zod 3.x release exists. All first-party packages resolve the catalog's
`zod ^4.6.6` and are not affected.

The only remaining path is `apps/docs > @nuxt/content > zod` (3.25.76). Every
published `@nuxt/content` 3.x release, including the current 3.16.2, requires
`zod ^3.25.76`, so no lockfile update or override resolves it without breaking
module load. @nuxt/content uses zod for its collection schema definitions and
validates the repository's own documentation sources at build time; it does not
validate collections supplied by users or network peers, and Docs production
packaging serves the built output.

The entry suppresses exactly this advisory monorepo-wide; it does not lower the
high-severity threshold or ignore other zod advisories. Reassess if any package
starts validating untrusted input with zod 3, and remove the exception when
@nuxt/content publishes a release depending on zod 4 (or a patched zod 3.x
exists) and the lockfile resolves it for the affected path.

Sources:

- https://github.com/advisories/GHSA-mrhx-c7xc-m3w5

The owner-approved exceptions change audit classification only. CI remains
unit-only; E2E/layout stays manual. Production activation, live conversion and
concrete external actions retain their separate approvals.
