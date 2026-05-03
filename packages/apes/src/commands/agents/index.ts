import { defineCommand } from 'citty'
import { destroyAgentCommand } from './destroy'
import { listAgentsCommand } from './list'
import { llmCommand } from './llm'
import { registerAgentCommand } from './register'
import { spawnAgentCommand } from './spawn'

export const agentsCommand = defineCommand({
  meta: {
    name: 'agents',
    description: 'Manage owned agents (register, spawn, list, destroy)',
  },
  subCommands: {
    register: registerAgentCommand,
    spawn: spawnAgentCommand,
    list: listAgentsCommand,
    destroy: destroyAgentCommand,
    llm: llmCommand,
  },
})
