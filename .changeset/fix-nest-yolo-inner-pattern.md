---
'@openape/apes': patch
---

`apes nest authorize` default allow_patterns now also covers the inner setup.sh-grant that `apes agents spawn` shells out to (`bash *apes-spawn-*setup.sh`). Without it, the outer spawn auto-approves but the inner privileged setup blocks on a fresh DDISA prompt.
