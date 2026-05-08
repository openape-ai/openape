---
'@openape/apes': major
---

**BREAKING**: SP renamed from `tribe` to `troop` ("troop" is the primatologically-correct collective for apes).

Migration for self-hosted agents:
- Env var: `OPENAPE_TRIBE_URL` → `OPENAPE_TROOP_URL`
- Default URL: `https://tribe.openape.ai` → `https://troop.openape.ai`
- launchd plist labels: `openape.tribe.sync.<agent>` → `openape.troop.sync.<agent>`,
  `openape.tribe.<agent>.<task>` → `openape.troop.<agent>.<task>`

After upgrading, run `apes agents spawn <name>` again to re-bootstrap with new
plist labels, or manually `launchctl bootout` the old labels and re-sync.
