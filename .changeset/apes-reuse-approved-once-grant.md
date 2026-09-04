---
"@openape/apes": patch
---

Reuse an approved `once` grant instead of asking for a second approval.

`findExistingGrant` and `findExistingCompoundGrant` skipped every `once` grant,
so a caller that had already obtained approval — like the OpenClaw grant gate,
which pre-flights the grant before exec starts — handed the command to
ape-shell and triggered a fresh approval request for the same command. The
human approved twice, or the run timed out having been approved once.

Single use is unaffected: it is enforced at `/consume`, which marks the grant
`used` and answers `already_consumed` afterwards, and the lookup only ever
queries `status=approved`. Once grants are matched strictly on `argv_hash`
rather than the looser coverage rules, because `verifyAndConsume` enforces that
hash for once grants — a grant that merely covered the command would fail the
run instead of prompting for a new one.
