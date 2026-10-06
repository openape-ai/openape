# Internal macOS signing

A personal/internal installation can be Developer ID signed and notarized without
representing a public distribution release. From clean canonical source, build
Pods and run `node scripts/package.mjs --distribution --signed-local` in the app
workspace. Set `OPENAPE_PODS_SIGNING_IDENTITY` to the Developer ID Application
identity and `OPENAPE_PODS_NOTARY_PROFILE` to an existing keychain profile. Never
store signing credentials or API private keys in this repository.

The internal mode requires a clean, current build and unchanged dependency lock,
uses hardened runtime and timestamps, notarizes/staples both app and DMG, and
keeps `releaseReady: false` with all unresolved license blockers in the embedded
BOM. Its artifact suffix is `signed-local`. It is for the authorized internal
installation only. It does not satisfy the license gate for external delivery.

Run `pnpm test:distribution --signed-local` to verify the mounted, notarized app
in an isolated profile with synthetic identity and a harmless deterministic run.
The check verifies Gatekeeper acceptance and stapling before startup. It does not
contact real mail, LLM or Telegram providers or activate production schedules.

`--signed-candidate` and `--signed` retain their license-review gate. General
release additionally requires the existing signed-boundary, clean-machine,
real-provider, real-tenant-refresh, physical-sleep/wake and OS/CPU checks. A valid
Apple signature does not complete those checks. A preliminary conservative
Codex Cargo.lock inventory found missing publisher license texts; that review
remains pending and must not be marked passed by the internal signing flow.
