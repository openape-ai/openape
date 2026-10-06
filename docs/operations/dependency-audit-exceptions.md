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

## simple-git 3.x via Nuxt DevTools (four advisories)

Patrick decided on October 6, 2026 (issue 1428) that audit findings are resolved
through dependency updates wherever a patched release exists and that an
exception is defined only where none can be installed. Seven of the nine
advisories published on October 5 were resolved by lockfile overrides
(proxy-addr 2.0.8, seroval 1.6.7, source-map-js 1.2.2, vue 3.5.43 with
@vue/server-renderer, prosemirror-view 1.42.6). The remaining four concern
`simple-git`:

- GHSA-x6jw-m9v5-85vh: unsafe-operation guard does not block trailer command
  configuration (critical)
- GHSA-v5rq-49vh-5v5c: `VISUAL` editor environment variable omitted from unsafe
  editor detection (`@simple-git/argv-parser`, critical)
- GHSA-g4wm-2vf7-vfgr: command execution through unblocked Git configuration
  includes (high)
- GHSA-858h-whjf-mvg5: unsafe-operations plugin bypass via long-option
  abbreviation (high)

All four are fixed in `simple-git` 4.0.1 / `@simple-git/argv-parser` 2.0.1.
Those releases cannot be installed: simple-git 4 removes the default export and
every published `@nuxt/devtools` 3.x release (up to 3.4.2, the range Nuxt 4.5.2
requires) still does `import Git from 'simple-git'`. With the 4.x override,
`nuxt prepare` in `apps/docs` fails at module load, so the override pins
`simple-git` to `>=3.36.0 <4` and the four advisory IDs are listed in
`auditConfig.ignoreGhsas`.

The only path in this monorepo is `apps/docs > nuxt > @nuxt/devtools > simple-git`.
Nuxt DevTools is development-time tooling: it runs simple-git against the
developer's own checkout during `nuxt dev`, never against repository content
supplied by users or network peers, and Docs production packaging serves the
built `.output/public` without DevTools. The advisories describe argument and
configuration injection into git invocations by an attacker who controls the
arguments passed to simple-git; no first-party code calls simple-git.

The entries suppress exactly these four advisories monorepo-wide; they do not
lower the high-severity threshold or ignore other simple-git advisories.
Reassess when `@nuxt/devtools` publishes a release depending on simple-git 4
(then raise the override and remove the four entries), or if any package starts
calling simple-git with untrusted input.

Sources:

- https://github.com/advisories/GHSA-x6jw-m9v5-85vh
- https://github.com/advisories/GHSA-v5rq-49vh-5v5c
- https://github.com/advisories/GHSA-g4wm-2vf7-vfgr
- https://github.com/advisories/GHSA-858h-whjf-mvg5
- https://repos.openape.ai/patrick/monorepo/issues/1428

The owner-approved exceptions change audit classification only. CI remains
unit-only; E2E/layout stays manual. Production activation, live conversion and
concrete external actions retain their separate approvals.
