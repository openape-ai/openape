---
"@openape/apes": patch
---

`apes nest authorize` now whitelists `bash *apes-destroy-*teardown.sh`
in the nest's YOLO allow-list. The spawn-side equivalent was already
there; destroy was missing, so every destroy-from-troop flow popped
a per-call grant prompt even though the outer `apes agents destroy *`
was already auto-approved. Operators who already ran
`apes nest authorize` once need to re-run it to pick up the new
pattern (or wait for the auto-renewal of the YOLO policy at next
install).
