---
'@openape/apes': patch
---

Fix `apes agents spawn` exiting nonzero after macOS user creation. Two related bugs:

1. **`$NAME` unbound inside `su - $NAME -c '...'`**: the inner shell starts fresh and doesn't inherit `NAME` from setup.sh. With `set -u`, the first `$NAME` reference inside the single-quoted block crashed the inner shell, propagated through `set -e` in setup.sh, and made the whole spawn fail despite the user being created. Fix: interpolate the literal name at TS-template time so the inner shell never sees a bash variable.

2. **`launchctl bootstrap gui/<uid>` fails for hidden service accounts**: spawned agents have `IsHidden=1` and never log in graphically, so the user's `gui/<uid>` launchd domain doesn't exist. `bootstrap` fails with "Domain does not support specified action". Fix: prefix with `launchctl asuser <uid>` (run as root in setup.sh) which bootstraps launchd for that uid first, then the inner bootstrap runs in the now-existing domain.

Repro: any fresh `apes agents spawn <name>` failed with `Command failed: bash setup.sh` while leaving the macOS user + plist files in place but no active launchd job. Manual `launchctl bootstrap` later would have hit the same domain error.
