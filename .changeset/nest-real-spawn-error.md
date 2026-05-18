---
"@openape/nest": patch
---

Surface the real spawn/sync failure instead of the JS stack tail. The
nest used to forward only the last 3 stderr lines, which for a failed
`apes` command are V8 stack frames (`at async runMain …`) — the actual
error message was discarded. Now stack frames are dropped and the
human-readable error lines are kept, so troop shows why a spawn failed.
