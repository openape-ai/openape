import { defineCommand } from 'citty'
import {
  makeDocsCommand,
  makeLoginCommand,
  makeLogoutCommand,
  makeWhoamiCommand,
  runProofCli,
} from '@openape/proof-cli'
import { callsClient } from './client.ts'
import { listCommand, showCommand, waitCommand } from './commands/calls.ts'
import agent from './docs/agent.md'
import auth from './docs/auth.md'
import cli from './docs/cli.md'

const DESCRIPTOR = {
  name: 'calls',
  endpoint: 'https://troop.openape.ai',
  envVar: 'OPENAPE_TROOP_URL',
  aud: 'troop.openape.ai',
  configFile: 'auth-calls.json',
} as const

const DOCS: Record<string, string> = { agent, auth, cli }

const main = defineCommand({
  meta: {
    name: 'ape-calls',
    version: '0.1.0',
    description: [
      'The decisions a human still owes you. `ape-calls wait <id>` blocks until',
      'the call is answered and prints the answer — a long-poll, so it returns',
      'within a second of the click.',
      '',
      'First time? `apes login <email>` once on this device. Agent reference:',
      '`ape-calls docs agent`.',
    ].join('\n'),
  },
  subCommands: {
    list: listCommand,
    show: showCommand,
    wait: waitCommand,
    login: makeLoginCommand(DESCRIPTOR),
    logout: makeLogoutCommand(DESCRIPTOR, callsClient),
    whoami: makeWhoamiCommand(DESCRIPTOR, callsClient),
    docs: makeDocsCommand(DESCRIPTOR, DOCS),
  },
})

runProofCli(main)
