---
'@openape/pods': patch
---

When the Pods app is not running, the MCP tool now names the launch command that also works from agent and Electron shells, which export `ELECTRON_RUN_AS_NODE=1` and would otherwise start the app as plain Node that quits at once.
