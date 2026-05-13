---
"@openape/nest": patch
---

Test-time safety guard: `OPENAPE_NEST_REGISTRY_PATH` env override
in `resolveRegistryPath()`. Without it, `pnpm test` on a dev
machine that has a real nest installed (the post-Phase-G
`/var/openape/nest/` directory exists) hits the real production
registry — and the existing "shrugs off corrupt JSON" vitest case
writes `{not json` to whatever `REGISTRY_PATH` resolves to.
Happened in practice once and lost the production agents.json
until manual reconstruction. The vitest setup now sets the
override so the test stays sandboxed to its tmpdir.
