---
"@openape/nest": minor
---

Handle `destroy-intent` frames from troop: runs
`apes agents destroy --force` for the named agent, then sends a
`destroy-result` frame back. Pairs with the new "Delete agent"
button in the troop UI — owners can wipe an agent from any device
without SSHing into the host.
