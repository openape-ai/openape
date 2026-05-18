---
"@openape/apes": patch
---

Fix agent spawn UID allocation. The setup script picked
`max(existing UID in [200,500)) + 1`, so once any agent landed on UID
499 every subsequent `apes agents spawn` failed with "No free UID in
[200, 500) — refusing to clobber a real user" even with 100+ UIDs
free. Now it scans for the lowest actually-unused UID in the range
(skipping agent users and macOS system accounts) and reuses gaps.
