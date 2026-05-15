---
"@openape/apes": minor
---

`apes agents destroy` Phase-G teardown no longer goes through a
temp bash script. Instead the command re-invokes itself via
`apes run --as root -- apes agents destroy <name> --force --root-stage`
and runs the privileged ops (launchctl bootout, pkill, rm -rf home
+ ecosystem-config dirs) directly in Node when re-entered as root.

DDISA grant request now reads
`apes agents destroy <name> --force --root-stage` instead of
`bash /var/folders/.../apes-destroy-<name>-XXXX/teardown.sh` —
semantically meaningful AND matches the existing nest YOLO pattern
`apes agents destroy *` for zero-prompt auto-approval. No new
allow-pattern needed.

`buildPhaseGTeardownScript` (the old bash builder) is kept as
dead code for now — back-compat reference, not called by anything
in-repo. Will drop in a follow-up once the new flow has bedded in.
