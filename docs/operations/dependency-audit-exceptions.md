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

`auditConfig.ignoreCves` suppresses this exact CVE throughout this monorepo;
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

The owner-approved exceptions change audit classification only. CI remains
unit-only; E2E/layout stays manual. Production activation, live conversion and
concrete external actions retain their separate approvals.
