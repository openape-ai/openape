---
"@openape/apes": patch
---

`apes nest install --bridge-model <m>` now writes the
`APE_CHAT_BRIDGE_MODEL=<m>` line to BOTH `~/litellm/.env` and the
nest's own `~/.openape/nest/litellm/.env`. Previously it only wrote
the first. Since the nest daemon's launchd plist pins
`HOME=~/.openape/nest`, every nest-driven spawn (TroopWs handler →
`apes agents spawn`) read the per-nest litellm/.env — which lacked
the model line — so the bridge for the new agent crash-looped with
`fatal: APE_CHAT_BRIDGE_MODEL is not set` on every boot. Patrick-
shell-driven spawns worked because they read `~/litellm/.env`
directly.
