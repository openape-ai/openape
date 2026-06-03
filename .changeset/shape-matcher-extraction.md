---
"@openape/grants": minor
---

Add a shared `shape-matcher` module (`matchArgvToOperation`, `buildCliAuthDetail`, `ShapeMatchOperation`) and route both the server-side shape resolver and apes' client-side command parser through it, removing ~150 lines of duplicated argv-matching logic. Behaviour is unchanged.
