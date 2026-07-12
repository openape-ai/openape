---
"@openape/prompt-injection-detector": minor
---

Add a browser-safe `./heuristic` export exposing only the pure `classifyHeuristic` (no `fs`), so the detector's scoring can run client-side. The barrel `.` export still re-exports the Node-only audit/config modules.
