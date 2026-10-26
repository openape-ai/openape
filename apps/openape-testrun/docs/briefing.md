# Versioned daily briefings

`shared/briefing.ts` defines the stored format. `validateBriefing` rejects unknown
fields before publication. Both versions keep the existing private series,
immutable daily publication, exact byte digest and version-pinned URL contract.
The transport limit remains 60 KiB. Existing version 1 documents remain readable.

Version 2 adds `topics` and `sourceCoverage`. The producer freezes `overview`
once and reuses it verbatim as the authenticated inbox message body. Push titles
remain generic and dated. This format uses source-bound editorial explanations;
`importantItems` and `nextActions` must be empty.

Every included email is referenced by exactly one topic through its account and
message ID. Topic IDs are unique, each topic has at least one reference, and at
most three topics use `placement: focus`. Other topics remain accessible under
additional information. Grouping is editorial; it does not establish that two
alerts describe the same incident or that an old incident remains unresolved.

`sourceCoverage` identifies a source and account, with population `inbox` or
`open-information` and status `complete`, `partial` or `unknown`. Explicit nullable
counts distinguish available messages, scanned metadata, considered message
bodies, included message rows and exact information items. Included counts must
match the body. Complete coverage cannot omit candidates or have unknown counts.
Each included account has exactly one coverage entry. Calendar and unavailable
non-mail sources retain their existing source descriptions and explicit gaps.

Assessed mail preserves full `informationItems: [{ id, text }]` separately from
editorial summaries. Information IDs are unique. Producers compare these items
with their frozen input before committing the edition; downstream publishers
check delivered coverage against the final body before publishing or notifying.
Topic summaries never establish delivery of underlying information. Budgets
must omit whole information items before deriving delivered coverage.

Calendar arithmetic uses Europe/Vienna. All-day entries are separate from timed
appointments, their end dates are exclusive, and adjacent timed intervals do not
conflict. A source label or all-day flag does not establish a duty or a free day.

Deploy compatible Reports readers before enabling a v2 producer. The personal
publisher must accept both versions before the editorial writer switches. Never
regenerate an existing day or change its effect key. On rollback, stop the v2
writer first and retain readers and a publisher that can finish frozen v2 data.
Personal recipes, mailbox data and production receipts do not belong in Git.
