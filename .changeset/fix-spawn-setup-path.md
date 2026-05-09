---
'@openape/apes': patch
---

`apes agents spawn`'s setup.sh now exports a wide PATH at the top — escapes-spawned scripts inherit a minimal PATH that excludes `/usr/sbin` (where chown / dscl / pwpolicy live), so privileged setup hit `chown: command not found` at line 131. Now resolves without forcing absolute paths.
