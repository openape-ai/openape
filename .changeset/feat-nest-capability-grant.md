---
'@openape/apes': minor
---

`apes nest install` now bundles + writes an `apes-agents.toml` shapes adapter to `~/.openape/shapes/adapters/`, and a new `apes nest authorize` command requests a single capability-grant covering all agent names via selector glob `name=*`. After approving once as Always, every nest-driven `apes agents spawn|destroy|sync` reuses the grant silently — selectorValueMatches treats `*` as a regex glob (existing logic in @openape/grants).

Without the adapter, plain run-grants do exact-arg matching and never reuse across different agent names; this closes that gap so the nest-daemon's zero-prompt spawn loop actually works.
