---
"@openape/ape-agent": patch
---

Don't DM the owner for a silent successful `command` schedule. A service
agent that polls a queue every minute and drains nothing now records the run
in troop but sends no chat message; only a failure or actual output is
reported.
