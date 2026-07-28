import type { SpTaskDb } from '@openape/sp-tasks'
import { defineResolveTaskHandler } from '@openape/sp-tasks/handlers'
import { useDb } from '../../../database/drizzle'
import { resolveServiceAgent } from '../../../utils/service-agent'

// ResolveTask — the service-agent posts progress or a terminal result (the answer).
export default defineResolveTaskHandler({
  db: () => useDb() as unknown as SpTaskDb,
  resolveAgent: resolveServiceAgent,
})
