---
'@openape/apes': minor
---

`apes agents spawn` now skips the second redundant `apes run --as root` escalation when it's already running as root. Net effect: only ONE DDISA approval per new agent (the outer `apes run --as root -- apes agents spawn <name>` from the wrapper), down from two.

The inner escalation existed for the case where `apes agents spawn` is invoked directly (not via `apes nest spawn`) — then it does need to ask for root privileges. But when called from `apes nest spawn` (which already wraps in `apes run --as root`), the second grant is pure redundancy. We detect via `process.getuid() === 0` and bash setup.sh inline in that case.

Plus: `apes run` audience-mode now reuses approved `timed`/`always` grants matching the requested command exactly, instead of always creating a fresh pending grant. Same agent spawned twice → 0 approvals on the second call. New agent name → still needs one approval (per name).
