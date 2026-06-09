---
"@openape/ape-agent": minor
"@openape/nest": minor
---

Dev recipe mount: `OPENAPE_RECIPE_DEV_DIR` lets a bind-mounted local recipe
directory override the synced `~/recipe` for scheduled `command` tasks, so an
operator can iterate on a recipe's `tools/` without a publish→deploy→sync
round-trip. The nest forwards the variable into each bridge's pm2 env; the
in-bridge cron runner (`resolveRecipeDir`) uses it as the command cwd when set,
falling back to `~/recipe`.
