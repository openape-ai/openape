---
"@openape/shapes": minor
"@openape/apes": minor
---

Registry adapters can be loaded as the only accepted adapters.
`loadRegistryAdapter(index, cliId)` returns the installed adapter of a
shapes-registry entry only when its file bytes match the entry's `digest` and,
when the index records it, its semantic digest matches `grant_digest`; otherwise
it throws a `RegistryAdapterError` (`not_in_registry`, `not_installed`,
`digest_mismatch`) that names the `apes adapter install` step.
`[cli] tested_digests` lists SHA-256 file digests of tested executables for
tools without a version command. `checkCliVersion` treats a listed digest or a
`version_command` output naming one of `tested_versions` as tested;
`bindsExecutable` accepts an executable only by the adapter's executable name or
a tested digest; `exactCommand` binds a resolved command to its exact argv
(`exact_command`). `RegistryEntry` gains the optional `grant_digest`;
`installedAdapterPath` names where `apes adapter install` keeps an adapter.

`authorizeAssignedCommand` accepts `exact: true` on an assigned command: the
grant token must then carry the command's argv hash, also when a wider grant
covers the operation.
