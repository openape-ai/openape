---
"@openape/apes": minor
---

`apes agents spawn` and `apes nest spawn` now install the ape-agent runtime by default.

Previously the `--bridge` flag was an opt-in. But an agent without the runtime has no chat connection, no LLM loop, and no cron execution — it's just a DDISA account plus a macOS user plus a troop sync. For the common case (an agent that actually does things), `--bridge` was effectively mandatory and easy to forget.

Inverted: bridge is the default. Pass `--no-bridge` to skip the runtime install (CI / headless / IdP-only account provisioning).

Breaking change for CI scripts that relied on the no-bridge default: add `--no-bridge` explicitly.
