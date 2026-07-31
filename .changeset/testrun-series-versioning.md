---
'@openape/ape-testruns': minor
---

`upload --series <key>`: stable, versioned proof links. Re-uploading with the
same series key (same uploader) updates the SAME report link — the version
increments and earlier versions stay viewable via `?v=<n>` — instead of
minting a new link per upload. Without a series key nothing changes.
