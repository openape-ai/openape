---
"@openape/apes": minor
"@openape/ape-agent": patch
---

Retires the per-agent SOUL.md field — its job (long-form markdown
persona, always-on rules) is now part of `system_prompt`. One
concept instead of two overlapping ones. Cleaner UX: troop's
agent-detail page no longer has a separate SOUL.md card, and the
spawn-dialog presets pre-fill the merged system_prompt directly.

Limit bumps to 32KB (was 8KB) since system_prompt now carries the
content that used to live in SOUL.md.

Back-compat: existing `~/.openape/agent/SOUL.md` files on already-
deployed hosts keep being read by the bridge's `composeSystemPrompt`
until the operator clears them — so legacy agents don't lose their
persona on the @openape/ape-agent upgrade. `apes agents sync`
stops writing the file from this version on; the DB column is
kept as a tombstone (Drizzle no longer references it, a future
migration will DROP it).
