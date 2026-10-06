import { readBody } from 'h3'
import { claimNext, markAgentPoll } from '../../../../utils/cockpit/queue'
import { requireCockpitAgent } from '../../../../utils/cockpit/auth'

let mseq = 0
export default defineEventHandler(async (event) => {
  const agent = await requireCockpitAgent(event)
  markAgentPoll(agent)
  // Optional body { company?, excludeCompanies? } — absent for legacy clients.
  const body = await readBody<{ company?: unknown, excludeCompanies?: unknown }>(event).catch(() => null)
  const company = typeof body?.company === 'string' ? body.company : undefined
  const excludeCompanies = Array.isArray(body?.excludeCompanies)
    ? body.excludeCompanies.filter((c): c is string => typeof c === 'string')
    : undefined
  const filter = company !== undefined || excludeCompanies !== undefined ? { company, excludeCompanies } : undefined
  const task = claimNext(agent, filter)
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
      // allowedTools + company are additive metadata (#1036): the worker reads
      // its command allowlist from here (data), not from the prompt (prose).
      // The history data-part format stays untouched — worker parse compat.
      metadata: { type: 'llm', assignee: task.owner || 'cockpit', deliveryCount: 1, company: task.company, allowedTools: task.allowedTools },
    },
  }
})
