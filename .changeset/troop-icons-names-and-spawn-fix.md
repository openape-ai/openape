---
"@openape/apes": patch
---

`apes agents spawn` now recycles a tombstone dscl record instead of
refusing the spawn outright. The Phase-G destroy flow leaves the
dscl user record behind by design (opendirectoryd refuses
`dscl . -delete` from escapes' setuid-root context without admin
auth), so re-spawning with the same name used to fail with
`User <name> already exists; refusing to overwrite`. Now: if the
prior NFSHomeDirectory is gone from disk (matching destroy's
`rm -rf`), the spawn reuses the existing UID + overwrites the
record's attributes. If the home is still on disk it's a live
agent — refuse as before.
