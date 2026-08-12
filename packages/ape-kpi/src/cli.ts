import { defineCommand } from 'citty'
import {
  makeDocsCommand,
  makeLoginCommand,
  makeLogoutCommand,
  makeWhoamiCommand,
  runProofCli,
} from '@openape/proof-cli'
import { kpiClient } from './client.ts'
import { pushCommand } from './commands/push.ts'
import { listCommand } from './commands/list.ts'
import agent from './docs/agent.md'
import cli from './docs/cli.md'
import errors from './docs/errors.md'

const DESCRIPTOR = {
  name: 'kpi',
  endpoint: 'https://dashboard.openape.ai',
  envVar: 'APE_KPI_ENDPOINT',
  aud: 'dashboard.openape.ai',
  configFile: 'auth-kpi.json',
} as const

const DOCS: Record<string, string> = { agent, cli, errors }

const main = defineCommand({
  meta: {
    name: 'ape-kpi',
    version: '0.1.0',
    description: [
      'Push KPIs to dashboard.openape.ai — agents report numbers as part of',
      'their normal work; the dashboard and the morning mail consume them.',
      '',
      'First time? `apes login <email>` once on this device. ape-kpi uses the',
      'unified apes session — same login covers ape-plans, ape-tasks and any',
      'other OpenApe CLI. Agent reference: `ape-kpi docs agent`.',
    ].join('\n'),
  },
  subCommands: {
    login: makeLoginCommand(DESCRIPTOR),
    logout: makeLogoutCommand(DESCRIPTOR, kpiClient),
    whoami: makeWhoamiCommand(DESCRIPTOR, kpiClient),
    push: pushCommand,
    list: listCommand,
    docs: makeDocsCommand(DESCRIPTOR, DOCS),
  },
})

runProofCli(main)
