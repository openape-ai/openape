import { eq } from 'drizzle-orm'
import { useDb } from '../../../database/drizzle'
import { agents, tasks } from '../../../database/schema'
import { requireAgent } from '../../../utils/auth'

// Agent reads its own task list + agent-level config (systemPrompt).
// No owner gate — the JWT's sub is the agent email and we filter rows
// on it. Returns the full spec the agent needs to:
//   - materialise launchd plists for cron tasks
//   - hydrate `~/.openape/agent/agent.json` (systemPrompt, used by both
//     the bridge daemon and the run command as the LLM `system` message)
export default defineEventHandler(async (event) => {
  const agentEmail = await requireAgent(event)
  const db = useDb()
  const agent = await db
    .select({ systemPrompt: agents.systemPrompt, tools: agents.tools })
    .from(agents)
    .where(eq(agents.email, agentEmail))
    .get()
  const taskList = await db
    .select()
    .from(tasks)
    .where(eq(tasks.agentEmail, agentEmail))
  return {
    system_prompt: agent?.systemPrompt ?? '',
    // tools[] = whitelist for chat-bridge runtime + cron task fallback.
    // The bridge writes this into ~/.openape/agent/agent.json on every
    // sync; bridge reads it from there at boot for live chat tool-calls.
    tools: agent?.tools ?? [],
    tasks: taskList,
  }
})
