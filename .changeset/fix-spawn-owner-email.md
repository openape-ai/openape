---
'@openape/apes': patch
---

Fix `apes agents spawn` writing the wrong `owner_email` into the new agent's `auth.json` when the spawn happens through a Nest (or any non-human caller). The IdP's `/api/enroll` resolves the owner transitively (the human at the top of the chain), but the cli was still writing `auth.email` (= the local caller, e.g. the Nest itself) into the agent's local auth.json. Result: the agent's auth.json carried the Nest's email as `owner_email`, and troop's `/api/agents/me/sync` rejected the call with a 400 because the owner-domain encoded in the agent's email (`patrick+hofmann_eco`) didn't match the locally-stored `owner_email`'s domain (`id.openape.ai`). Now uses `registration.owner` from the IdP response, matching what the server actually persisted.
