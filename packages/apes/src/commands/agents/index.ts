import { defineCommand } from 'citty'
import { allowAgentCommand } from './allow'
import { destroyAgentCommand } from './destroy'
import { listAgentsCommand } from './list'
import { registerAgentCommand } from './register'
import { runAgentCommand } from './run'
import { serveAgentCommand } from './serve'
import { spawnAgentCommand } from './spawn'
import { syncAgentCommand } from './sync'

export const agentsCommand = defineCommand({
  meta: {
    name: 'agents',
    description: 'Manage owned agents (register, spawn, list, destroy, allow, sync, run, serve)',
  },
  subCommands: {
    register: registerAgentCommand,
    spawn: spawnAgentCommand,
    list: listAgentsCommand,
    destroy: destroyAgentCommand,
    allow: allowAgentCommand,
    sync: syncAgentCommand,
    run: runAgentCommand,
    serve: serveAgentCommand,
  },
})
