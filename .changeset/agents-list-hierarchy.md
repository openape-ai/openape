---
'@openape/ape-troop': minor
---

`agents list` groups agents by company and shows the reporting hierarchy
(Operator/CEO → Teamlead → Specialists) instead of one flat list. Agents
without a company are listed in a trailing "Ohne Firma" group. Reads the new
`orgId`/`orgName`/`orgRole`/`reportsToEmail` fields from `/api/agents`; against
an older troop that omits them every agent simply lands in that group.
