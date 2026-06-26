import { defineCommand } from 'citty'
import {
  makeDocsCommand,
  makeLoginCommand,
  makeLogoutCommand,
  makeWhoamiCommand,
  runProofCli,
} from '@openape/proof-cli'
import { prClient } from './client.ts'
import { openCommand } from './commands/open.ts'
import { listCommand, rmCommand, statusCommand } from './commands/prs.ts'
import { uploadCommand } from './commands/upload.ts'
import agent from './docs/agent.md'
import auth from './docs/auth.md'
import cli from './docs/cli.md'
import manifest from './docs/manifest.md'

const DESCRIPTOR = {
  name: 'pr',
  endpoint: 'https://pr.openape.ai',
  envVar: 'APE_PR_ENDPOINT',
  aud: 'pr.openape.ai',
  configFile: 'auth-pr.json',
} as const

const DOCS: Record<string, string> = { agent, auth, cli, manifest }

const main = defineCommand({
  meta: {
    name: 'ape-pr',
    version: '0.1.1',
    description: [
      'Upload a pull request — diff, description, images — and review it on a',
      'beautiful surface: https://pr.openape.ai/prs/<id>. Poll the verdict back',
      'with `ape-pr status <slug>`.',
      '',
      'First time? `apes login <email>` once on this device. ape-pr uses the',
      'unified apes session — same login covers ape-tasks, ape-plans and any',
      'other OpenApe CLI. Manifest format: `ape-pr docs manifest`.',
      'Agent reference: `ape-pr docs agent`.',
    ].join('\n'),
  },
  subCommands: {
    upload: uploadCommand,
    status: statusCommand,
    list: listCommand,
    open: openCommand,
    rm: rmCommand,
    whoami: makeWhoamiCommand(DESCRIPTOR, prClient),
    login: makeLoginCommand(DESCRIPTOR),
    logout: makeLogoutCommand(DESCRIPTOR, prClient),
    docs: makeDocsCommand(DESCRIPTOR, DOCS),
  },
})

await runProofCli(main)
