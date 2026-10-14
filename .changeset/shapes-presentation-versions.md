---
"@openape/grants": minor
"@openape/shapes": minor
---

Shapes adapters can carry approval presentation and tested CLI versions.
`[operation.presentation]` holds German and English card texts (`title`,
`statement`, `consequence`, `facts`, `details`, `details_note`) that may only
reference bindings the operation produces; `[cli] tested_versions`,
`version_command` and `version_pattern` name the checked CLI versions.
`parseAdapterToml` (now exported) reads adapters with a TOML parser and rejects
unknown keys at every level; derived permissions stay unchanged, including the
original comma split of array strings. `ServerShape` gains `versions` and
operations their `presentation`. The matcher rejects a resource name that is
not a plain identifier, so a two-key selector split at its comma (the former gh
`repo:owner=…,name=…` chain, which granted every repository of an owner) fails
closed instead of producing a permission with an unbound template.

`LoadedAdapter.digest`, which grants bind as `adapter_digest`, is now the
semantic digest (`semanticAdapterDigest`) over the matching rules only, so
presentation, display texts, tested versions and comments can change without
invalidating grants. `loadAdapter` adds `fileDigest` (file bytes) for integrity
checks; the installer keeps verifying registry downloads by file digest.
