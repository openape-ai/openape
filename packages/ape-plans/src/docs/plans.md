# Plans

A plan is Markdown body + minimal metadata. Structure emerges from the
Markdown (headings, checklists). Anyone in the owning team can read; editors
and owners can write.

## Status

One of `draft`, `active`, `done`, `archived`. Default on create is `draft`.

- `draft` — work in progress, not ready for others to act on.
- `active` — currently being executed.
- `done` — complete.
- `archived` — historical, hidden from default listings (MVP: still returned
  by `list` unless filtered, but expected to be default-filtered later).

## Ownership

The creator is the plan's `owner_email`. The plan owner OR a team owner can
soft-delete the plan. Any editor/owner in the team can update title/body/status.

## Recovery after Reports consolidation

Removal denies access to every version. The owner can recover for 30 days using
`ape-reports restore ID --permanent` or another explicit new lifetime. Restoration
starts private; after 30 days online content is purged. Updates do not renew expiry.

## Update tracking and conflicts

`show --json` includes immutable `version`, `updated_at` and `updated_by`. Status
is descriptive metadata; explicit user approval is recorded separately.

The consolidated service requires `expected_version` on writes, returns 428 for
old unversioned clients, and rejects stale writes with 409. Interactive editing
uses the version loaded before opening the editor. File/stdin replacement requires
the version of the source originally read:

```sh
ape-plans show ID --json
ape-plans edit ID --body-from-file plan.html --expected-version 3
```

Keep your draft after a conflict and reconcile the newer source. Never retry by
blindly substituting the latest version. Append/prepend/section operations transform
the freshly read source and submit that version. Status/removal also accept an
explicit `--expected-version`; otherwise they use the version read by the command.
The CLI remains usable against the pre-consolidation service during rollout.
