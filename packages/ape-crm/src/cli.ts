import { defineCommand } from 'citty'
import {
  makeDocsCommand,
  makeLoginCommand,
  makeLogoutCommand,
  makeWhoamiCommand,
  runProofCli,
} from '@openape/proof-cli'
import { crmClient } from './client.ts'
import { acceptCommand } from './commands/accept.ts'
import { contactsCommand } from './commands/contacts.ts'
import { dealsCommand } from './commands/deals.ts'
import { noteCommand } from './commands/note.ts'
import { stagesCommand } from './commands/stages.ts'
import { workspacesCommand } from './commands/workspaces.ts'
import agent from './docs/agent.md'
import cli from './docs/cli.md'

const DESCRIPTOR = {
  name: 'crm',
  endpoint: 'https://crm.openape.ai',
  envVar: 'APE_CRM_ENDPOINT',
  aud: 'crm.openape.ai',
  configFile: 'auth-crm.json',
} as const

const DOCS: Record<string, string> = { agent, cli }

const main = defineCommand({
  meta: {
    name: 'ape-crm',
    version: '0.1.0',
    description: [
      'Deal pipeline, contacts and notes — for humans and AI agents.',
      '',
      'First time? `apes login <email>` once on this device. ape-crm uses the',
      'unified apes session — same login covers ape-plans, ape-tasks and any other',
      'OpenApe CLI. Agent reference: `ape-crm docs agent`.',
    ].join('\n'),
  },
  subCommands: {
    login: makeLoginCommand(DESCRIPTOR),
    logout: makeLogoutCommand(DESCRIPTOR, crmClient),
    whoami: makeWhoamiCommand(DESCRIPTOR, crmClient),
    workspaces: workspacesCommand,
    deals: dealsCommand,
    stages: stagesCommand,
    contacts: contactsCommand,
    note: noteCommand,
    accept: acceptCommand,
    docs: makeDocsCommand(DESCRIPTOR, DOCS),
  },
})

await runProofCli(main)
