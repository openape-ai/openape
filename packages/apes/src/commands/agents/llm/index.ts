import { defineCommand } from 'citty'
import { llmSetupCommand } from './setup'
import { llmUnsetupCommand } from './unsetup'

export const llmCommand = defineCommand({
  meta: {
    name: 'llm',
    description: 'Per-machine LLM proxy that agents can talk to (setup, unsetup)',
  },
  subCommands: {
    setup: llmSetupCommand,
    unsetup: llmUnsetupCommand,
  },
})
