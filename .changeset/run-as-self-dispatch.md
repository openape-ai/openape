---
'@openape/apes': patch
---

Allow `apes run --as <user>` to self-dispatch from inside ape-shell.

When an agent inside ape-shell runs `apes run --as root -- <cmd>`, the
inner `apes` process has its own escapes-audience grant flow. Previously,
the ape-shell grant layer treated all `apes run` invocations as gated
and fell through to a generic session-grant that never reached escapes.
Now `apes run --as` is recognized as a self-dispatch, so the inner
process handles the escapes grant flow directly.

`apes run` without `--as` remains gated as before.
