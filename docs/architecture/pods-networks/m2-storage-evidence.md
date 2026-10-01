# M2 storage and backup evidence

Native [PR 202](https://repos.openape.ai/patrick/monorepo/pulls/202),
[issue 1417](https://repos.openape.ai/patrick/monorepo/issues/1417).
The isolated checkout is `openape-monorepo.worktrees/pods-workflows-networks`,
branch `feature/issue-1417-pods-networks-m2`, canonical base
`df832d9d816b97f404eb9f260c834ad8606ed080`.
Clean tested runtime source: `7dc40d6352d0d7cd994d729db89c0b6a115d4c25`.

## Actual checks

- Full root lint/typecheck, Pods build and all 131 files / 905 unit tests pass
  on the clean runtime source. Native exact-source CI run 5307 passes.
- Root lint repeats reuse 54/54 tasks; typecheck 76/77. The preceding source-tree
  verification reused 53/54 lint and 73/77 typecheck tasks. Direct final Pods
  execution is fresh. Required commit and push unit gates pass; push reuses 67/68
  tasks. This distinguishes actual execution from cached validation.
- Real isolated schema-27 migration preserves all 89 legacy table definitions and
  row fingerprints, 15,334 files and all 86 encrypted credential files. The stopped
  original source hashes remain unchanged. The generated pre-migration schema-27
  rollback copy has identical legacy rows/DDL. Reopening is idempotent.
- Actual encrypted export/restore of that migrated copy succeeds. Restored state
  is paused and fenced. The proof key is ephemeral and deliberately not persisted;
  its archive is test evidence, not an owner recovery backup.
- The actual canonical schema-27 reader refuses schema 28 before data operations.
  Database bytes remain unchanged. SQLite read-only WAL probing creates empty WAL
  and SHM sidecars; directory immutability is not claimed.
- Three independent full-file Claude Code 2.1.286 / Opus 5.5 reviews and one
  targeted final closure review identify and close the storage/restore/encryption
  blockers and majors. The targeted review covers supplied excerpts only and
  executes no tests. Primary review checks the complete source context, actual
  receipts and untruncated native source/target diff.

[Verified private Test Runs receipt](https://report.openape.ai/r/_Y36InfIXpYhK1Bc0ro0kMz2). Owner API readback is 200,
anonymous API readback is 401; category is Test Runs and visibility is private.
The earlier report's cache counts describe the preceding source-tree gate; this
receipt explicitly records both that gate and the clean-commit repeat.
Private raw owner receipts remain under
`~/Library/Application Support/OpenApe Pods Implementation/issue-1417/m2/`.
Only sanitized counts and results are published.

## Review decisions and dependent gates

The migration is additive; existing workflows and channel graphs are not converted.
Network activation is hidden. Keep startup fail-closed for unexpected private
staging entries after removing all recognized plaintext stages; regular Finder
metadata is tolerated. The diagnostic reaches runtime setup. Cleanup is invoked
only during private initialization, before worker domain recovery. M9 must
coordinate it with newly exposed backup jobs and provide recovery guidance.

The encrypted codec is additive to existing portable plaintext exports. Owner key
provisioning and data-control UI remain M9 work. The independent encrypted-manifest
ceiling is 32 MiB, so long paths can reach it before the 100,000-file limit. File
counts/ciphertext lengths remain visible; the live database is not encrypted by
this format. Credentials remain excluded from portable export and are preserved
in the separate paired profile copy, as before.

M3/M4 must prove actual network authority, atomic settlement, admission, recovery,
projection reconciliation and fair dispatch. M5/M6 add gate/data authority;
M7 calls/joins; M9 actual desktop/browser UX and inspected screenshots;
M10 bounded authenticated publication; M11 reviewed migration/sharing;
M12 feedback; M13 signed relay-first rollout; M14 observation.
Automatic CI remains unit-only and E2E/layout remain manual. No UI screenshot,
provider action, production activation or live owner migration is claimed here.
Never replace a later owner profile with the pre-migration copy; rollback uses
forward fixes and isolated old-profile inspection.
