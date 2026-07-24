import { getTask, resolve } from '../../../../utils/cockpit/queue'
import { saveChatMessage } from '../../../../utils/cockpit/chat-store'
import { removeTask, saveTask } from '../../../../utils/cockpit/task-store'
import type { TaskState } from '../../../../utils/cockpit/queue'
import { requireCockpitAgent } from '../../../../utils/cockpit/auth'
import { ownsTask } from '../../../../utils/cockpit/resolve-guard'
import { resolveRefs } from '../../../../utils/cockpit/file-store'

const MAX_QUESTION_LEN = 500
const MAX_OPTIONS = 4
const MAX_OPTION_LEN = 80

export default defineEventHandler(async (event) => {
  const agent = await requireCockpitAgent(event)
  const body = await readBody<{ id?: string; state?: TaskState; retryInMs?: unknown; question?: unknown; options?: unknown; artifact?: { parts?: { kind?: string; text?: string, fileId?: string }[] } }>(event)
  const id = body?.id
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const state: TaskState = body?.state ?? 'completed'
  const text = (body?.artifact?.parts ?? []).find(p => p.kind === 'text')?.text ?? ''
  // Attachment parts: every fileId must exist AND belong to this agent's owner —
  // otherwise 400 before anything is written (guard lesson from #989).
  const fileIds = (body?.artifact?.parts ?? []).filter(p => p.kind === 'file' && typeof p.fileId === 'string').map(p => p.fileId as string)
  const files = fileIds.length ? await resolveRefs(agent, fileIds) : []
  if (files === null) throw createError({ statusCode: 400, statusMessage: 'invalid file parts' })
  if (state === 'deferred' && (typeof body?.retryInMs !== 'number' || !Number.isFinite(body.retryInMs) || body.retryInMs <= 0 || body.retryInMs > 24 * 60 * 60_000)) {
    throw createError({ statusCode: 400, statusMessage: 'retryInMs must be a positive number ≤ 24h' })
  }
  let ask: { question: string, options: string[] } | undefined
  if (state === 'input-required') {
    const question = typeof body?.question === 'string' ? body.question.trim() : ''
    if (!question || question.length > MAX_QUESTION_LEN)
      throw createError({ statusCode: 400, statusMessage: `question required, ≤ ${MAX_QUESTION_LEN} chars` })
    const rawOptions = Array.isArray(body?.options) ? body.options : []
    const options = rawOptions.filter(o => typeof o === 'string' && o.trim()).map(o => (o as string).trim())
    if (options.length !== rawOptions.length || options.length > MAX_OPTIONS || options.some(o => o.length > MAX_OPTION_LEN))
      throw createError({ statusCode: 400, statusMessage: `options: ≤ ${MAX_OPTIONS} non-empty strings, each ≤ ${MAX_OPTION_LEN} chars` })
    ask = { question, options }
  }
  const task = getTask(id)
  const resolved = resolve(id, state, text, agent, state === 'deferred' ? body.retryInMs as number : undefined, ask)
  if (!resolved) return { ok: true }
  const ownGuarded = ownsTask(task, agent) // task exists AND belongs to this agent
  if (state === 'deferred' && ownGuarded) void saveTask({ ...task!, notBefore: task!.notBefore, lastNote: text || undefined }).catch(err => console.error('[task-store] save', err))
  if (state === 'input-required' && ownGuarded && ask) {
    // Durability + the persistent chat rendition (chips come from `meta` on reload).
    void saveTask({ ...task!, question: ask.question, options: ask.options, askedAt: task!.askedAt }).catch(err => console.error('[task-store] save', err))
    await saveChatMessage(task!.company, task!.owner, 'assistant', ask.question, { taskId: id, options: ask.options })
  }
  // Persist the assistant turn for both outcomes: a completed answer, or a failed
  // task's honest notice — so a failure leaves a visible message instead of silence.
  if ((state === 'completed' || state === 'failed') && task && task.owner === agent && (text.trim() || files.length)) await saveChatMessage(task.company, task.owner, 'assistant', text.trim() || '(Anhang)', undefined, files)
  // Task is terminal → drop its durability row so it isn't re-run after a restart.
  if (state === 'completed' || state === 'failed') void removeTask(id).catch(err => console.error('[task-store] remove', err))
  return { ok: true }
})
