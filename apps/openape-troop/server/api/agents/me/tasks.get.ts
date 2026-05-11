import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../database/drizzle'
import { agents, agentSkills, tasks } from '../../../database/schema'
import { requireAgent } from '../../../utils/auth'

// Agent reads its own task list + agent-level config. No owner gate —
// the JWT's sub is the agent email and we filter rows on it.
// Returns the full spec the agent needs to:
//   - materialise launchd plists for cron tasks
//   - hydrate `~/.openape/agent/agent.json` (systemPrompt + tools)
//   - hydrate `~/.openape/agent/SOUL.md` (always-on persona / rules)
//   - hydrate `~/.openape/agent/skills/<name>/SKILL.md` (lazy-load
//     instruction documents the agent's LLM loads on demand)
export default defineEventHandler(async (event) => {
  const agentEmail = await requireAgent(event)
  const db = useDb()
  const agent = await db
    .select({
      systemPrompt: agents.systemPrompt,
      tools: agents.tools,
      soul: agents.soul,
    })
    .from(agents)
    .where(eq(agents.email, agentEmail))
    .get()
  const taskList = await db
    .select()
    .from(tasks)
    .where(eq(tasks.agentEmail, agentEmail))
  // Only enabled skills get sent to the agent. Disabled rows stay in
  // the troop UI so the owner can toggle them back without re-typing
  // the body, but the LLM never sees them in the meantime.
  const skillRows = await db
    .select({
      name: agentSkills.name,
      description: agentSkills.description,
      body: agentSkills.body,
    })
    .from(agentSkills)
    .where(and(eq(agentSkills.agentEmail, agentEmail), eq(agentSkills.enabled, true)))
  return {
    system_prompt: agent?.systemPrompt ?? '',
    // tools[] = whitelist for chat-bridge runtime + cron task fallback.
    tools: agent?.tools ?? [],
    soul: agent?.soul ?? '',
    skills: skillRows,
    tasks: taskList,
  }
})
