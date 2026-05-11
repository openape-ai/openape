---
"@openape/ape-agent": minor
"@openape/apes": minor
---

Agent skills (SKILL.md) + SOUL.md, modeled on OpenClaw's lazy-load skill pattern.

**`@openape/ape-agent`** gains a system-prompt composer that scans `~/.openape/agent/skills/*/SKILL.md` + `~/.openape/agent/SOUL.md` on every new chat thread and injects an `<available_skills>` block into the LLM system prompt. The LLM loads each skill's body lazily via the `file.read` tool when the task description matches — keeps the cold-start prompt small even as the skill catalog grows. SOUL.md is always-on (no lazy load) — persona, language preferences, hard rules.

Default skills for the six built-in tool families (`time`, `http`, `file`, `tasks`, `mail`, `bash`) ship bundled with the package under `default-skills/`. They get merged with agent-side skills (same-name agent skill wins) and filtered against the agent's enabled tools — a skill whose `requires_tools` aren't enabled is dropped from the prompt.

**`@openape/apes`** — `apes agents sync` now writes:

- `~/.openape/agent/SOUL.md` (from troop's `soul` column)
- `~/.openape/agent/skills/<name>/SKILL.md` for each enabled row in troop's `agent_skills` table

The sync is a one-way mirror: rows deleted/disabled in troop get pruned from disk on the next sync. Existing agents pick up the feature on first sync after the deploy; their SOUL is empty and their skills list is empty until the owner adds some in the troop UI.

**Troop** (separate app, not versioned here) adds:

- `agents.soul TEXT NOT NULL DEFAULT ''`
- new `agent_skills` table: `(agent_email, name)` primary key, `description`, `body`, `enabled`
- `PATCH /api/agents/:name` accepts `soul: string`
- `GET /api/agents/:name/skills`, `PUT /api/agents/:name/skills`, `DELETE /api/agents/:name/skills/:skillName`
- Agent detail page: SOUL.md textarea + Skills CRUD (modal editor)
