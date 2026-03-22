import consola from 'consola'
import { defineCommand, runMain } from 'citty'
import { loginCommand } from './commands/login'
import { logoutCommand } from './commands/logout'
import { whoamiCommand } from './commands/whoami'
import { requestCommand } from './commands/request'
import { requestCmdCommand } from './commands/request-cmd'
import { requestCapabilityCommand } from './commands/request-capability'
import { listCommand } from './commands/list'
import { statusCommand } from './commands/status'
import { tokenCommand } from './commands/token'
import { revokeCommand } from './commands/revoke'
import { approveCommand } from './commands/approve'
import { denyCommand } from './commands/deny'
import { runCommand } from './commands/run'
import { delegateCommand } from './commands/delegate'
import { delegationsCommand } from './commands/delegations'
import { ApiError } from './http'

const debug = process.argv.includes('--debug')

declare const __VERSION__: string

const main = defineCommand({
  meta: {
    name: 'grapes',
    version: __VERSION__,
    description: 'Universal Grant Management CLI for OpenApe',
  },
  subCommands: {
    login: loginCommand,
    logout: logoutCommand,
    whoami: whoamiCommand,
    request: requestCommand,
    'request-cmd': requestCmdCommand,
    'request-capability': requestCapabilityCommand,
    list: listCommand,
    status: statusCommand,
    token: tokenCommand,
    revoke: revokeCommand,
    approve: approveCommand,
    deny: denyCommand,
    run: runCommand,
    delegate: delegateCommand,
    delegations: delegationsCommand,
  },
})

runMain(main).catch((err) => {
  if (debug) {
    consola.error(err)
  }
  else {
    consola.error(err instanceof Error ? err.message : String(err))
  }
  process.exit(1)
})
