import { defineCommand } from 'citty'
import {
  makeDocsCommand,
  makeLoginCommand,
  makeLogoutCommand,
  makeWhoamiCommand,
  runProofCli,
} from '@openape/proof-cli'
import { testrunClient } from './client.ts'
import { openCommand } from './commands/open.ts'
import { listCommand, rmCommand, showCommand } from './commands/runs.ts'
import { uploadCommand } from './commands/upload.ts'
import agent from './docs/agent.md'
import auth from './docs/auth.md'
import cli from './docs/cli.md'
import manifest from './docs/manifest.md'

const DESCRIPTOR = {
  name: 'testruns',
  endpoint: 'https://testrun.openape.ai',
  envVar: 'APE_TESTRUNS_ENDPOINT',
  aud: 'testrun.openape.ai',
  configFile: 'auth-testruns.json',
} as const

const DOCS: Record<string, string> = { agent, auth, cli, manifest }

const main = defineCommand({
  meta: {
    name: 'ape-testruns',
    version: '0.1.1',
    description: [
      'Upload a test run — descriptions, screenshots, pass/fail — and share one',
      'link that proves it works: https://testrun.openape.ai/r/<slug>.',
      '',
      'First time? `apes login <email>` once on this device. ape-testruns uses the',
      'unified apes session — same login covers ape-tasks, ape-plans and any other',
      'OpenApe CLI. Manifest format: `ape-testruns docs manifest`.',
      'Agent reference: `ape-testruns docs agent`.',
    ].join('\n'),
  },
  subCommands: {
    upload: uploadCommand,
    list: listCommand,
    show: showCommand,
    rm: rmCommand,
    open: openCommand,
    whoami: makeWhoamiCommand(DESCRIPTOR, testrunClient),
    login: makeLoginCommand(DESCRIPTOR),
    logout: makeLogoutCommand(DESCRIPTOR, testrunClient),
    docs: makeDocsCommand(DESCRIPTOR, DOCS),
  },
})

await runProofCli(main)
