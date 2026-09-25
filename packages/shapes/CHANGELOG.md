# @openape/shapes

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
