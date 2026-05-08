---
'@openape/apes': patch
---

Fix `apes agents spawn` crashing on the troop-sync-install line with `setup.sh: line N: NAME…: unbound variable`. With `set -u`, `$NAME…` was parsed as a variable named `NAME…` (the U+2026 ellipsis got eaten into the identifier). Use `${NAME}…` so the brace cleanly terminates the variable name. Same fix applied to the bridge-install echo.
