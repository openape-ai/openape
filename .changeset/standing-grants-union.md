---
'@openape/grants': minor
---

evaluateStandingGrants deckt Multi-Detail-Requests jetzt als Union ÜBER
mehrere Standing Grants: jedes Detail muss von mindestens einer
anwendbaren Regel gedeckt sein (Scope-Filter je Regel gegen die von ihr
gedeckten Details). Nötig für Compound-Requests mit Details mehrerer CLIs
(o365 + jq) — kein einzelnes Grant kann zwei cli_ids spannen.
