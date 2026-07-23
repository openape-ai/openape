import { claimNext, markAgentPoll } from '../../../../utils/cockpit/queue'
import { requireCockpitAgent } from '../../../../utils/cockpit/auth'

let mseq = 0
export default defineEventHandler(async (event) => {
  const agent = await requireCockpitAgent(event)
  markAgentPoll(agent)
  const task = claimNext(agent)
  if (!task) return { task: null }
  mseq += 1
  const contextId = `cockpit:${task.company}`
  return {
    task: {
      kind: 'task',
      id: task.id,
      contextId,
      status: { state: 'working' },
      history: [{
        kind: 'message',
        messageId: `m${Date.now()}-${mseq}`,
        role: 'user',
        parts: [{ kind: 'data', data: { systemPrompt: task.systemPrompt, userMessage: task.userMessage, files: task.files ?? [] } }],
        taskId: task.id,
        contextId,
      }],
      artifacts: [],
      metadata: { type: 'llm', assignee: task.owner || 'cockpit', deliveryCount: 1 },
    },
  }
})
