# Historical context

The following areas contain dated decisions and prior work, not current task
assignments or authoritative operational commands:

- `.claude/plans/` and `docs/superpowers/plans/` contain prior designs/handoffs.
- `.claude/commands/` contains historical Claude-specific workflow helpers.
  Check their assumptions against AGENTS.md before invoking them, especially
  GitHub/Forgejo PR commands and release order.
- Old references to `origin` meaning Forgejo precede the 2026-09-07 remote
  migration. `.openape/repository.json` identifies the canonical repository.
- The sibling `openape-plans`, `openape-tasks`, `openape-timetrack` repositories
  are archived on Forgejo. Their active applications live under `apps/` here.
- Desktop is described as being decommissioned in the prior engineering guide;
  its checkout is preserved. Do not treat that note as permission to delete it.

The default source search excludes historical plans. For a specifically selected
historical task, read its exact file or use `rg --no-ignore` on that directory.
The live plan and active-work index identify work that is still being continued.
