---
'@openape/agent-runtime': patch
---

Drop `cost-snapshots` from the `troop.company.read` resource list. The
endpoint it called has been removed from troop; the remaining resources
(`objectives`, `reports`, `members`, `overview`) are unchanged.
