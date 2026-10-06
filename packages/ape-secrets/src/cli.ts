import { defineCommand } from 'citty'
import { makeLoginCommand, makeLogoutCommand, makeWhoamiCommand, runProofCli } from '@openape/proof-cli'
import { secretsClient } from './client.ts'
import {
  consumersCommand,
  fetchCommand,
  keygenCommand,
  listCommand,
  requestCommand,
  statusCommand,
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
      'The machine generates a key pair and keeps the private half. A request',
      'asks a human for one value; they fill it in their browser, where it is',
      'sealed against that key. The service in between stores an envelope it',
      'cannot open, and hands it over exactly once.',
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
  },
})

await runProofCli(main)
