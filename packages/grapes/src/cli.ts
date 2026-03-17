import consola from 'consola'
import { defineCommand, runMain } from 'citty'
import { loginCommand } from './commands/login'
import { logoutCommand } from './commands/logout'
import { whoamiCommand } from './commands/whoami'
import { requestCommand } from './commands/request'
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

// Human-readable errors by default, stack traces with --debug
if (!debug) {
  process.on('uncaughtException', (err) => {
    if (err instanceof ApiError) {
      consola.error(err.message)
    }
    else {
      consola.error(err.message || String(err))
    }
    process.exit(1)
  })
  process.on('unhandledRejection', (err) => {
    if (err instanceof ApiError) {
      consola.error(err.message)
    }
    else if (err instanceof Error) {
      consola.error(err.message)
    }
    else {
      consola.error(String(err))
    }
    process.exit(1)
  })
}

const main = defineCommand({
  meta: {
    name: 'grapes',
    version: '0.1.0',
    description: 'Universal Grant Management CLI for OpenAPE',
  },
  subCommands: {
    login: loginCommand,
    logout: logoutCommand,
    whoami: whoamiCommand,
    request: requestCommand,
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

runMain(main)
