import { defineCommand } from 'citty'
import { allowAgentCommand } from './allow'
import { destroyAgentCommand } from './destroy'
import { listAgentsCommand } from './list'
import { registerAgentCommand } from './register'
import { spawnAgentCommand } from './spawn'
import { syncAgentCommand } from './sync'

export const agentsCommand = defineCommand({
  meta: {
    name: 'agents',
    description: 'Manage owned agents (register, spawn, list, destroy, allow, sync)',
  },
  subCommands: {
    register: registerAgentCommand,
    spawn: spawnAgentCommand,
    list: listAgentsCommand,
    destroy: destroyAgentCommand,
    allow: allowAgentCommand,
    sync: syncAgentCommand,
  },
})
