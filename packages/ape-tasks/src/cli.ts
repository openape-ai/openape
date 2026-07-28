import { defineCommand } from 'citty'
import {
  makeDocsCommand,
  makeLoginCommand,
  makeLogoutCommand,
  makeWhoamiCommand,
  runProofCli,
} from '@openape/proof-cli'
import { tasksClient } from './client.ts'
import { teamsCommand } from './commands/teams.ts'
import { acceptCommand } from './commands/accept.ts'
import {
  listCommand,
  showCommand,
  newCommand,
  editCommand,
  statusCommand,
  doneCommand,
  reopenCommand,
  rmCommand,
  lanesCommand,
} from './commands/tasks.ts'
import { openCommand } from './commands/open.ts'
import agent from './docs/agent.md'
import auth from './docs/auth.md'
import cli from './docs/cli.md'
import errors from './docs/errors.md'
import invites from './docs/invites.md'
import tasks from './docs/tasks.md'
import teams from './docs/teams.md'

const DESCRIPTOR = {
  name: 'tasks',
  endpoint: 'https://tasks.openape.ai',
  envVar: 'APE_TASKS_ENDPOINT',
  aud: 'tasks.openape.ai',
  configFile: 'auth-tasks.json',
} as const

const DOCS: Record<string, string> = { agent, auth, cli, errors, invites, tasks, teams }

const main = defineCommand({
  meta: {
    name: 'ape-tasks',
    version: '1.3.1',
    description: [
      'Shared task lists for humans and AI agents — persisted across devices and sessions.',
      '',
      'First time? `apes login <email>` once on this device. ape-tasks uses the',
      'unified apes session — same login covers ape-plans and any future OpenApe CLI.',
      'Agent reference: `ape-tasks docs agent`. Skill for Claude Code: see',
      'https://github.com/openape-ai/tasks/blob/main/skills/ape-tasks/SKILL.md.',
    ].join('\n'),
  },
  subCommands: {
    login: makeLoginCommand(DESCRIPTOR),
    logout: makeLogoutCommand(DESCRIPTOR, tasksClient),
    whoami: makeWhoamiCommand(DESCRIPTOR, tasksClient),
    teams: teamsCommand,
    accept: acceptCommand,
    list: listCommand,
    lanes: lanesCommand,
    show: showCommand,
    new: newCommand,
    edit: editCommand,
    status: statusCommand,
    done: doneCommand,
    reopen: reopenCommand,
    rm: rmCommand,
    open: openCommand,
    docs: makeDocsCommand(DESCRIPTOR, DOCS),
  },
})

await runProofCli(main)
