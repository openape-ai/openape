---
'@openape/core': minor
'@openape/apes': minor
---

Add a supervised owner-script execution mode that reuses the native sandbox
launcher and records owner activation separately from IdP grants. Preserve typed
pre-start permission and infrastructure failures through the private lifecycle
channel so controllers can safely distinguish permission rechecks from unknown
execution outcomes.
