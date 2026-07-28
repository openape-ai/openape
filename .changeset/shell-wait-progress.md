---
'@openape/apes': patch
---

Emit a progress line on stderr every 15 s while waiting for grant approval (#1065). Both the adapter-path `waitForGrantStatus` and the generic ape-shell session-grant poll loop now report `⏳ still waiting for approval … <n>s (grant <id-prefix>)` so callers with stall heuristics can tell an ongoing wait from a hang. stdout stays untouched; suppress with `APES_QUIET_WAIT=1`.
