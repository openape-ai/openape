import { defineCommand } from 'citty'
import { deployAgentCommand } from './deploy'

// `apes agent …` (singular) — owner-side recipe operations, distinct
// from `apes agents …` (plural) which manages the owner's own agent
// lifecycle on a host.
export const agentCommand = defineCommand({
  meta: {
    name: 'agent',
    description: 'Agent Recipe operations (deploy)',
  },
  subCommands: {
    deploy: deployAgentCommand,
  },
})
