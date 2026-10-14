---
"@openape/core": major
"@openape/grants": minor
"@openape/nuxt-auth-idp": minor
"@openape/apes": minor
---

Grant request summaries are structured (grants.md §3.4, issue 1473):
`summary` is `{ title, description?, origin?, link? }` with a one-line title of
at most 120 characters, a description of at most 2000 characters and a
one-line origin set by the requester's runtime. `summary.text` is removed. The
IdP refuses requests that still send `text`, unknown members, oversized fields
or Unicode control, format and line/paragraph separator characters (line feeds
are allowed in the description) and renders title, description, origin and
link as the requester's statement. `@openape/grants` exports
`parseGrantSummary` and `migrateLegacyGrantSummary`. `apes run` replaces
`--summary` with `--summary-title`, `--summary-description` and
`--summary-origin`; `--summary-link` stays.
