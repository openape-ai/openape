---
'@openape/apes': minor
'@openape/nest': patch
---

Phase G follow-up: `apes nest destroy <name>` (and `apes agents destroy`) is now fully scriptable for Phase G+ agents — no admin-password prompt, no TTY required.

Detection: if the agent's `NFSHomeDirectory` (read from dscl) starts with `/var/openape/homes/`, the new `buildPhaseGTeardownScript` runs via `apes run --as root` and:
  - launchctl bootout + pkill
  - rm -rf /var/openape/homes/<name> (no FDA wall on /var/, root just does it)
  - rm -rf /var/openape/agents/<name> (per-agent ecosystem files)
  - skip sysadminctl entirely — the dscl record stays as a hidden tombstone (uid in service range, IsHidden=1, NFSHomeDirectory pointing nowhere). Operators can `sudo sysadminctl -deleteUser <name>` interactively for full cleanup; the tombstone is otherwise harmless.

Legacy agents under `/Users/<name>/` still go through the old sudo + sysadminctl + admin-password path — `rm -rf /Users/...` hits FDA without a UI session.

Plus: registry file mode bumped from 600 to 660 (group `_openape_nest`) so the human user can `apes nest list` without sudo. The file holds no secrets.
