---
"@openape/ape-agent": minor
---

Adds a hidden default persona that ships with the package and is
prepended to every agent's system prompt. Adapted from OpenClaw's
SOUL.md template — a short markdown document ("Be genuinely
helpful, not performatively helpful", "Have opinions", "Earn trust
through competence", boundaries + vibe + continuity). No owner-
facing surface; new agents inherit it for free and a fresh
ape-agent release rolls out persona updates everywhere on bridge
reload.

Owner-supplied `system_prompt` content is appended after the
default persona + skills block, so anything the owner writes still
takes the last word.
