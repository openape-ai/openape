---
'@openape/proof-cli': minor
---

PR uploads raise a `call.raised` event (kind: verdict) instead of the legacy `verdict.requested`. Requires a troop that speaks @openape/attention-events 0.4.0 — live on prod since prod-b8b0bf5d.
