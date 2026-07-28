---
'@openape/apes': patch
---

Security: `ape-shell -c` no longer executes after an approval timeout (#1070)

The blocking wait in `apes run --shell --wait` / `APE_WAIT=1` left its poll
loop on two paths — approval, or the 5-minute ceiling — and executed the
command afterwards either way. An undecided grant therefore ran without any
human decision: waiting it out was enough to bypass the approval requirement,
while the grant record stayed `pending`, so the audit trail claimed the
command had never been approved. Measured against production: grant created,
never decided, command executed with exit 0 exactly 300s later.

An undecided grant now fails closed with `Grant approval timed out after 5
minutes.` and a non-zero exit. The adapter path (`waitForGrantStatus`) and the
`apes grants request` helpers already behaved correctly and are unchanged.
