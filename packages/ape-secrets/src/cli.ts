import { defineCommand } from 'citty'
import { makeLoginCommand, makeLogoutCommand, makeWhoamiCommand, runProofCli } from '@openape/proof-cli'
import { secretsClient } from './client.ts'
import {
  consumersCommand,
  deliverCommand,
  fetchCommand,
  keygenCommand,
  listCommand,
  requestCommand,
  statusCommand,
  waitCommand,
} from './commands.ts'

const DESCRIPTOR = {
  name: 'secrets',
  endpoint: 'https://secrets.openape.ai',
  envVar: 'APE_SECRETS_ENDPOINT',
  aud: 'secrets.openape.ai',
  configFile: 'auth-secrets.json',
} as const

const main = defineCommand({
  meta: {
    name: 'ape-secrets',
    version: '0.1.0',
    description: [
      'Hand a secret to a machine without it passing through a chat, a ticket',
      'or anyone\'s scrollback.',
      '',
      'The machine generates a key pair and keeps the private half (`keygen`).',
      'Ask the owner\'s vault for a secret with `request --secret NAME`; the',
      'owner approves it with a passkey, `wait` reports the approval, and',
      '`deliver` writes the value to a file or hands it to a command. The value',
      'is sealed for this machine and signed by the vault; it is never printed.',
      '',
      'First time? `apes login <email>` once on this device.',
    ].join('\n'),
  },
  subCommands: {
    login: makeLoginCommand(DESCRIPTOR),
    logout: makeLogoutCommand(DESCRIPTOR, secretsClient),
    whoami: makeWhoamiCommand(DESCRIPTOR, secretsClient),
    keygen: keygenCommand,
    consumers: consumersCommand,
    request: requestCommand,
    list: listCommand,
    status: statusCommand,
    fetch: fetchCommand,
    wait: waitCommand,
    deliver: deliverCommand,
  },
})

await runProofCli(main)
