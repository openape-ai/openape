import consola from 'consola'
import { defineCommand, runMain } from 'citty'
import { loginCommand } from './commands/auth/login'
import { logoutCommand } from './commands/auth/logout'
import { whoamiCommand } from './commands/auth/whoami'
import { listCommand } from './commands/grants/list'
import { inboxCommand } from './commands/grants/inbox'
import { statusCommand } from './commands/grants/status'
import { requestCommand } from './commands/grants/request'
import { requestCapabilityCommand } from './commands/grants/request-capability'
import { approveCommand } from './commands/grants/approve'
import { denyCommand } from './commands/grants/deny'
import { revokeCommand } from './commands/grants/revoke'
import { tokenCommand } from './commands/grants/token'
import { delegateCommand } from './commands/grants/delegate'
import { delegationsCommand } from './commands/grants/delegations'
import { delegationRevokeCommand } from './commands/grants/delegation-revoke'
import { adminCommand } from './commands/admin/index'
import { adapterCommand } from './commands/adapter/index'
import { runCommand } from './commands/run'
import { explainCommand } from './commands/explain'
import { configGetCommand } from './commands/config/get'
import { configSetCommand } from './commands/config/set'
import { fetchCommand } from './commands/fetch/index'
import { mcpCommand } from './commands/mcp/index'
import { initCommand } from './commands/init/index'
import { enrollCommand } from './commands/enroll'
import { registerUserCommand } from './commands/register-user'
import { dnsCheckCommand } from './commands/dns-check'
import { workflowsCommand } from './commands/workflows'
import { ApiError } from './http'
import { CliError, CliExit } from './errors'

// Gracefully handle EPIPE when stdout is closed early (e.g. piped to `head`)
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0)
  throw err
})

const debug = process.argv.includes('--debug')

declare const __VERSION__: string

const grantsCommand = defineCommand({
  meta: {
    name: 'grants',
    description: 'Grant management',
  },
  subCommands: {
    list: listCommand,
    inbox: inboxCommand,
    status: statusCommand,
    request: requestCommand,
    'request-capability': requestCapabilityCommand,
    approve: approveCommand,
    deny: denyCommand,
    revoke: revokeCommand,
    token: tokenCommand,
    delegate: delegateCommand,
    delegations: delegationsCommand,
    'delegation-revoke': delegationRevokeCommand,
  },
})

const configCommand = defineCommand({
  meta: {
    name: 'config',
    description: 'Configuration management',
  },
  subCommands: {
    get: configGetCommand,
    set: configSetCommand,
  },
})

const main = defineCommand({
  meta: {
    name: 'apes',
    version: __VERSION__,
    description: 'Unified CLI for OpenApe',
  },
  subCommands: {
    init: initCommand,
    enroll: enrollCommand,
    'register-user': registerUserCommand,
    'dns-check': dnsCheckCommand,
    login: loginCommand,
    logout: logoutCommand,
    whoami: whoamiCommand,
    grants: grantsCommand,
    admin: adminCommand,
    run: runCommand,
    explain: explainCommand,
    adapter: adapterCommand,
    config: configCommand,
    fetch: fetchCommand,
    mcp: mcpCommand,
    workflows: workflowsCommand,
  },
})

runMain(main).catch((err) => {
  if (err instanceof CliExit) {
    process.exit(err.exitCode)
  }
  if (err instanceof CliError) {
    consola.error(err.message)
    process.exit(err.exitCode)
  }
  if (debug) {
    consola.error(err)
  }
  else {
    consola.error(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err))
  }
  process.exit(1)
})
