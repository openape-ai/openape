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
`checkCliVersion` compares the output of an adapter's `version_command` with its
`tested_versions`, and `exactCommand` binds a resolved command to its exact argv
(`exact_command`). `RegistryEntry` gains the optional `grant_digest`;
`installedAdapterPath` names where `apes adapter install` keeps an adapter.

`authorizeAssignedCommand` accepts `exact: true` on an assigned command: the
grant token must then carry the command's argv hash, also when a wider grant
covers the operation.
