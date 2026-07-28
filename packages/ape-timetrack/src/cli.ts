import { defineCommand } from 'citty'
import {
  makeDocsCommand,
  makeLoginCommand,
  makeLogoutCommand,
  makeWhoamiCommand,
  runProofCli,
} from '@openape/proof-cli'
import { timerackClient } from './client.ts'
import { companiesCommand } from './commands/companies.ts'
import { projectsCommand } from './commands/projects.ts'
import { membersCommand } from './commands/members.ts'
import { acceptCommand } from './commands/accept.ts'
import { logCommand, listCommand, editCommand, rmCommand } from './commands/entries.ts'
import { meCommand } from './commands/me.ts'
import { reportCommand } from './commands/report.ts'
import { openCommand } from './commands/open.ts'
import agent from './docs/agent.md'
import cli from './docs/cli.md'
import errors from './docs/errors.md'

const DESCRIPTOR = {
  name: 'timetrack',
  endpoint: 'https://timetrack.openape.ai',
  envVar: 'APE_TIMETRACK_ENDPOINT',
  aud: 'timetrack.openape.ai',
  configFile: 'auth-timetrack.json',
} as const

const DOCS: Record<string, string> = { agent, cli, errors }

const main = defineCommand({
  meta: {
    name: 'ape-timetrack',
    version: '0.1.5',
    description: [
      'Time tracking by company and project — for humans and AI agents.',
      '',
      'First time? `apes login <email>` once on this device. ape-timetrack uses the',
      'unified apes session — same login covers ape-plans, ape-tasks and any other',
      'OpenApe CLI. Agent reference: `ape-timetrack docs agent`.',
    ].join('\n'),
  },
  subCommands: {
    login: makeLoginCommand(DESCRIPTOR),
    logout: makeLogoutCommand(DESCRIPTOR, timerackClient),
    whoami: makeWhoamiCommand(DESCRIPTOR, timerackClient),
    companies: companiesCommand,
    projects: projectsCommand,
    members: membersCommand,
    accept: acceptCommand,
    me: meCommand,
    log: logCommand,
    list: listCommand,
    edit: editCommand,
    rm: rmCommand,
    report: reportCommand,
    open: openCommand,
    docs: makeDocsCommand(DESCRIPTOR, DOCS),
  },
})

await runProofCli(main)
