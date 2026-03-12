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
import { execCommand } from './commands/exec'
import { delegateCommand } from './commands/delegate'
import { delegationsCommand } from './commands/delegations'

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
    exec: execCommand,
    delegate: delegateCommand,
    delegations: delegationsCommand,
  },
})

runMain(main)
