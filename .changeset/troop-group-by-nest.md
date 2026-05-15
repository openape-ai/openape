---
'@openape/troop': patch
---

troop: group agents by nest (host) on the `/agents` overview. Each nest gets a hostname header with agent count; agents within a nest stay createdAt-desc, and nests sort by most-recent activity. Freshly-spawned agents whose first sync hasn't filled in the host identity yet live under a "Pending first sync" group at the bottom.
