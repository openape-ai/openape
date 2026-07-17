import { buildOrgSystemPrompt } from './org-context'
import { enqueue } from './queue'

// Enqueue a proactive Operator task for (owner, org): build the org grounding and
// hand `userMessage` to the queue. The always-on worker claims it like any cockpit
// task; the answer lands in the chat + fires a Web-Push. Returns false if the org
// is gone/unowned (nothing enqueued). Shared by the schedule evaluator and event
// hooks so every proactive path is grounded identically.
export async function fireProactiveTask(owner: string, orgId: string, userMessage: string): Promise<boolean> {
  const systemPrompt = await buildOrgSystemPrompt(owner, orgId)
  if (systemPrompt == null) return false
  enqueue(orgId, systemPrompt, userMessage, owner)
  return true
}
