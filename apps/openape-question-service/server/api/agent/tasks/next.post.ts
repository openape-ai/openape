import type { SpTaskDb } from '@openape/sp-tasks'
import { defineGetNextTaskHandler } from '@openape/sp-tasks/handlers'
import { useDb } from '../../../database/drizzle'
import { resolveServiceAgent } from '../../../utils/service-agent'

// GetNextTask — the bound service-agent long-polls this to claim one LLM task.
export default defineGetNextTaskHandler({
  db: () => useDb() as unknown as SpTaskDb,
  resolveAgent: resolveServiceAgent,
})
