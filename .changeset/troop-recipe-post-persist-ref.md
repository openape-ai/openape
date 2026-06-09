---
"@openape/troop": patch
---

`POST /api/agents/:name/recipe` now persists `recipe_ref`. Re-pointing a
deployed agent at a new recipe ref previously updated only the system prompt
and toolset, leaving the agent's checked-out `tools/` stuck on the old ref;
the iterate-on-deployed-agent path now actually moves the agent to the new
version.
