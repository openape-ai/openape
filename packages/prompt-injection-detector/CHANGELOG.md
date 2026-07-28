# @openape/prompt-injection-detector

## 0.2.0

### Minor Changes

- d8833f6: Add a browser-safe `./heuristic` export exposing only the pure `classifyHeuristic` (no `fs`), so the detector's scoring can run client-side. The barrel `.` export still re-exports the Node-only audit/config modules.
