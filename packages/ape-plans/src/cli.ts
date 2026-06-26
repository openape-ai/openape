import { defineCommand } from 'citty'
import {
  makeDocsCommand,
  makeLoginCommand,
  makeLogoutCommand,
  makeWhoamiCommand,
  runProofCli,
} from '@openape/proof-cli'
import { plansClient } from './client.ts'
import { teamsCommand } from './commands/teams.ts'
import { acceptCommand } from './commands/accept.ts'
import {
  listCommand,
  showCommand,
  newCommand,
  editCommand,
  statusCommand,
  rmCommand,
} from './commands/plans.ts'
import { openCommand } from './commands/open.ts'
import agent from './docs/agent.md'
import auth from './docs/auth.md'
import cli from './docs/cli.md'
import errors from './docs/errors.md'
import invites from './docs/invites.md'
import plans from './docs/plans.md'
import teams from './docs/teams.md'

const DESCRIPTOR = {
  name: 'plans',
  endpoint: 'https://plans.openape.ai',
  envVar: 'APE_PLANS_ENDPOINT',
  aud: 'plans.openape.ai',
  configFile: 'auth-plans.json',
} as const

const DOCS: Record<string, string> = { agent, auth, cli, errors, invites, plans, teams }

const main = defineCommand({
  meta: {
    name: 'ape-plans',
    version: '1.0.1',
    description: [
      'Living plans for humans and AI agents — persisted across sessions, devices, and hand-offs.',
      '',
      'First time? `apes login <email>` once on this device. ape-plans uses the',
      'unified apes session — same login covers ape-tasks and any future OpenApe CLI.',
      'Lost? `ape-plans docs agent` for the agent reference, or see the Claude skill',
      'at https://github.com/openape-ai/plans/blob/main/skills/ape-plans/SKILL.md.',
    ].join('\n'),
  },
  subCommands: {
    login: makeLoginCommand(DESCRIPTOR),
    logout: makeLogoutCommand(DESCRIPTOR, plansClient),
    whoami: makeWhoamiCommand(DESCRIPTOR, plansClient),
    teams: teamsCommand,
    accept: acceptCommand,
    list: listCommand,
    show: showCommand,
    new: newCommand,
    edit: editCommand,
    status: statusCommand,
    rm: rmCommand,
    open: openCommand,
    docs: makeDocsCommand(DESCRIPTOR, DOCS),
  },
})

await runProofCli(main)
