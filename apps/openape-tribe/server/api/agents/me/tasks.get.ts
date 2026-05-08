import { eq } from 'drizzle-orm'
import { useDb } from '../../../database/drizzle'
import { tasks } from '../../../database/schema'
import { requireAgent } from '../../../utils/auth'

// Agent reads its own task list. No owner gate — the JWT's sub is
// the agent email and we filter rows on it. Returns the full task
// spec the agent needs to materialise launchd plists + spec files.
export default defineEventHandler(async (event) => {
  const agentEmail = await requireAgent(event)
  const db = useDb()
  return await db
    .select()
    .from(tasks)
    .where(eq(tasks.agentEmail, agentEmail))
})
