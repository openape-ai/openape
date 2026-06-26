# @openape/proof-cli

Shared CLI core for OpenApe proof-link apps (tasks, testrun, pr, plans, timetrack).

Each of these CLIs shares the same login/logout/whoami/docs commands, the same
SP client, and the same error handling — differing only by app name and
endpoint. This package provides those shared pieces as small builders so each
app's `cli.ts` stays the composition root (it owns the command order and the
top-level meta) and only sources the shared command bodies from here.

```ts
import { defineCommand } from 'citty'
import {
  createProofClient,
  makeLoginCommand,
  makeLogoutCommand,
  makeWhoamiCommand,
  makeDocsCommand,
  runProofCli,
} from '@openape/proof-cli'

const d = {
  name: 'tasks',
  endpoint: 'https://tasks.openape.ai',
  envVar: 'APE_TASKS_ENDPOINT',
  aud: 'tasks.openape.ai',
  configFile: 'auth-tasks.json',
} as const

const client = createProofClient(d)

const main = defineCommand({
  meta: { name: 'ape-tasks', version: '1.4.0', description: '…' },
  subCommands: {
    login: makeLoginCommand(d),
    logout: makeLogoutCommand(d, client),
    whoami: makeWhoamiCommand(d, client),
    // …app-specific domain commands…
    docs: makeDocsCommand(d, DOCS),
  },
})

await runProofCli(main)
```

App-specific commands (`open`, the domain commands, `api.ts`, the docs content)
stay in the app — only the parts that are identical bar the app name live here.

## Exports

- `createProofClient(descriptor)` — the SP client (thin wrapper over `@openape/cli-auth`'s `createSpClient`)
- `makeLoginCommand` / `makeLogoutCommand` / `makeWhoamiCommand` / `makeDocsCommand` — shared command builders
- `runProofCli(main)` — shared error handling + `runMain`
- `info` / `error` / `printJson` / `printLine` / `printNdjson` / `fmtTime` — output helpers
- `ProofCliDescriptor` — the per-app config type

MIT © Delta Mind GmbH
