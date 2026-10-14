# @openape/shapes

## 0.10.0

### Minor Changes

- 9214ee1: Shapes adapters can declare their options and global options. An operation with
  `value_options` or `flag_options` accepts only declared options: value options
  bind the next token, flag options are flags, and any other option makes the
  operation not match (fail closed for options such as git `--upload-pack`).
  Declared and global options must use their exact dash form (`--name`, `-x`;
  bundles only of declared one-letter flags), so
  `merge-base --is-ancestor A B` keeps both positionals. `[cli] global_options`
  (for example `["C=repo"]` for `git -C <path>`) are accepted once before the
  command prefix and bound for every operation. Operations without these fields
  derive the same permissions as before.
- 1ab4dbd: Shapes adapters can carry approval presentation and tested CLI versions.
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

- ea20fbb: Registry adapters can be loaded as the only accepted adapters.
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

### Patch Changes

- Updated dependencies [40aeb4b]
- Updated dependencies [f2d7850]
- Updated dependencies [a020cb3]
- Updated dependencies [a766839]
- Updated dependencies [59bf5ed]
- Updated dependencies [be10b17]
- Updated dependencies [9214ee1]
- Updated dependencies [1ab4dbd]
- Updated dependencies [a419dad]
  - @openape/core@1.0.0
  - @openape/grants@0.14.0

## 0.9.1

### Patch Changes

- 3c8bc08: Add `@openape/openclaw-grant-gate`, an OpenClaw plugin that routes every agent `exec` through the DDISA grant flow.

  The grant is requested in `before_tool_call`, before exec starts, so waiting for a human is not bounded by the exec tool's timeout — the case that previously turned a 68-second approval into a grant that was approved but never ran. Execution stays with `ape-shell`, which verifies and consumes the grant token, and reuses an already-approved grant instead of asking twice.

  Requests are made with the agent's operator identity and approvals with the owner's; the IdP rejects self-approval, so the split is enforced on both sides. Everything uncertain fails closed.

  `@openape/shapes` gains a regression test pinning that a leading env assignment does not parse as an `apes` invocation — the parser behaviour that currently prevents `APES_AUTH_FILE=<owner> apes grants approve <id>` from bypassing the shell gate.

- Updated dependencies [b48b952]
  - @openape/core@0.21.0
  - @openape/grants@0.13.1

## 0.9.0

### Minor Changes

- bea8e00: Compound-Shell-Zeilen (`a | b`, `a && b`) laufen segmentweise durch die
  Shapes-Auflösung: EIN Grant-Request mit den strukturierten Details aller
  Segmente (Adapter wo vorhanden, Generic-Fallback sonst), Ausführung nach
  Approval als Original-Zeile. Substitution, Redirects, sudo-Segmente und
  gemischte Audiences fallen weiter fail-closed auf den opaken Pfad.

### Patch Changes

- Updated dependencies [0140dc3]
- Updated dependencies [42b3257]
  - @openape/core@0.20.0
  - @openape/grants@0.13.0

## 0.8.0

### Minor Changes

- af7f762: Honour `APES_AUTH_FILE` when resolving the caller identity (#1066)

  The adapter-backed grant path (`createShapesGrant`) resolves its identity
  through this package, not through `@openape/apes`. Without the override a
  wrapper running under an alternate identity — the worker's per-company
  operator — silently fell back to the logged-in human's `auth.json`, so
  adapter-backed commands (`uname`, `echo`, anything with a shapes adapter)
  created grants with the wrong requester and were judged against the wrong
  YOLO policy. Non-adapter commands were unaffected: they take the generic
  session-grant path inside `@openape/apes`, which already honoured it.

## 0.7.2

### Patch Changes

- Updated dependencies [76dd28c]
  - @openape/core@0.19.0
  - @openape/grants@0.12.2

## 0.7.1

### Patch Changes

- Updated dependencies [3e3dfea]
  - @openape/core@0.18.0
  - @openape/grants@0.12.1

## 0.7.0

### Minor Changes

- a0d8506: Extract the pure Shapes library core (parser, adapters, registry, installer, toml, capabilities, request-builders, shell-parser, types, audit, http, config) from `@openape/apes` into a new `@openape/shapes` package. Grant-orchestration and CLI glue stay in apes and consume the package. No behaviour change.
