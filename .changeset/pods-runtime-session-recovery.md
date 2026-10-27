---
'@openape/pods': patch
---

Remove the global Pod execution cap across scheduled, manual and controlled
starts, retaining per-Pod exclusion. Recover stale central workspace sessions
through the existing connection loop, fence late responses and reconcile stable
operation IDs before resubmission. Keep owner action results through reconnection.

Deploy the paired relay parser before the updated desktop: new scheduling views
omit the retired concurrency field. Existing database settings remain inert for
rollback compatibility.
