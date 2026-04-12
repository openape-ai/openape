---
"@openape/apes": minor
---

Support literal tokens in adapter positionals and remove the deprecated
`@openape/shapes` package.

The shapes adapter parser (`packages/apes/src/shapes/parser.ts`) now accepts
positional names prefixed with `=` as literal matchers — the corresponding argv
token must exactly equal the suffix and is not bound as a variable. This
enables adapters for CLIs whose command shape interleaves fixed keywords with
positional IDs, e.g.

```toml
[[operation]]
id = "task.archive"
command = ["project"]
positionals = ["project_id", "=workspace", "workspace_id", "=task", "task_id", "=archive"]
```

matches `iurio project 42 workspace 7 task 123 archive` and binds
`{project_id: '42', workspace_id: '7', task_id: '123'}`.

The standalone `@openape/shapes` package has been removed from the monorepo.
All shapes functionality has lived inside `@openape/apes` for some time and
nothing inside the workspace imported `@openape/shapes` anymore. The
`openape-free-idp` E2E test was ported to drive `apes run` instead of the
retired `shapes request` CLI, and the `openape-shapes` SKILL moved from
`packages/shapes/skills/` to `packages/apes/skills/`.
