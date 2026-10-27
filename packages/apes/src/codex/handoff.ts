import { realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { intentSchema, jobSchema, readSchema, startSchema, turnSchema } from './contract'
import type { Intent, Job, Rpc } from './contract'
import { assertPrivateDirectory, digest, publishRecord, readRecord } from './records'
import { requireApproval } from './approval'

export async function normalizeJob(value: unknown): Promise<Job> {
  const parsed = jobSchema.parse(value)
  const cwd = await realpath(parsed.cwd)
  if (!(await stat(cwd)).isDirectory()) throw new Error('Job cwd must be a directory')
  return {
    schema: parsed.schema,
    key: parsed.key,
    cwd,
    model: parsed.model,
    sandbox: parsed.sandbox,
    approvalPolicy: parsed.approvalPolicy,
    prompt: parsed.prompt,
    maxAgeSeconds: parsed.maxAgeSeconds,
  }
}

function directory(root: string, job: Job) { return join(root, digest(job.key)) }
function uncertain(intent: Intent, failure: unknown) {
  return !failure && Date.now() < Date.parse(intent.settleBy) ? 'dispatching' : 'unknown'
}
function inputText(intent: Intent) { return `[OpenApe job ${intent.digest}]\n${intent.job.prompt}` }
function matchesTurn(turn: z.infer<typeof turnSchema>, intent: Intent): boolean {
  const itemSchema = z.object({ type: z.literal('userMessage'), content: z.array(z.object({ type: z.literal('text'), text: z.string() })) })
  return turn.items.some((item) => {
    const parsed = itemSchema.safeParse(item)
    return parsed.success && parsed.data.content.length === 1 && parsed.data.content[0]?.text === inputText(intent)
  })
}

export async function status(root: string, job: Job, rpc: Rpc, options: { result?: boolean } = {}) {
  const folder = directory(root, job)
  const raw = await readRecord(folder, 'intent')
  if (!raw) return { state: 'not-started' }
  const intent = intentSchema.parse(raw)
  if (intent.digest !== digest(job)) throw new Error('Job key conflict: immutable inputs changed')
  const failure = await readRecord(folder, 'failure')
  const threadRaw = await readRecord(folder, 'thread')
  if (!threadRaw) {
    const refused = z.object({ phase: z.literal('approval'), cause: z.string() }).safeParse(failure)
    if (refused.success) return { state: 'blocked', phase: 'approval', reason: refused.data.cause }
    return { state: uncertain(intent, failure), phase: 'thread/start', reason: 'Intent exists without a durable thread response; never redispatch' }
  }
  const thread = startSchema.parse(threadRaw)
  const expectedSandbox = job.sandbox === 'read-only' ? 'readOnly' : 'dangerFullAccess'
  if (thread.model !== job.model || thread.cwd !== job.cwd || thread.approvalPolicy !== job.approvalPolicy || thread.sandbox.type !== expectedSandbox) {
    return { state: 'blocked', phase: 'configuration', threadId: thread.thread.id, reason: 'Effective execution configuration differs from the approved job' }
  }
  let read: z.infer<typeof readSchema>
  try { read = readSchema.parse(await rpc.call('thread/read', { threadId: thread.thread.id, includeTurns: true })) }
  catch (error) { return { state: 'unknown', phase: 'thread/read', threadId: thread.thread.id, reason: String(error) } }
  if (read.thread.id !== thread.thread.id || read.thread.cwd !== job.cwd) throw new Error('Thread identity mismatch')
  const recordedTurn = await readRecord(folder, 'turn')
  const turnId = recordedTurn ? z.object({ id: z.string() }).parse(recordedTurn).id : undefined
  const matches = read.thread.turns.filter(turn => turnId ? turn.id === turnId : matchesTurn(turn, intent))
  if (matches.length !== 1) return { state: matches.length > 1 ? 'unknown' : uncertain(intent, failure), phase: 'turn/start', threadId: thread.thread.id, reason: 'No unique matching turn; never redispatch' }
  const turn = matches[0]
  if (!turn) throw new Error('Missing matched turn')
  let reconciliationRecorded = Boolean(turnId)
  if (!turnId) {
    try { reconciliationRecorded = await publishRecord(folder, 'turn', { id: turn.id }) }
    catch (error) { return { state: 'unknown', phase: 'reconcile/persist', threadId: thread.thread.id, turnId: turn.id, reason: String(error) } }
  }
  const stale = turn.status === 'inProgress' && Date.now() - Date.parse(intent.requestedAt) > job.maxAgeSeconds * 1000
  if (options.result && turn.status === 'completed') {
    const unknown = (reason: string) => ({ state: 'unknown', phase: 'result', threadId: thread.thread.id, turnId: turn.id, reason })
    if (turn.itemsView !== 'full') return unknown('Completed turn items are not a full view; never infer a complete result')
    const candidates = turn.items.filter(item => typeof item === 'object' && item !== null && 'type' in item && item.type === 'agentMessage' && 'phase' in item && item.phase === 'final_answer')
    if (candidates.length !== 1) return unknown('Completed turn must contain exactly one final answer')
    const message = z.object({ id: z.string().min(1), text: z.string() }).safeParse(candidates[0])
    if (!message.success || /\p{Surrogate}/u.test(message.data.text) || Buffer.byteLength(message.data.text) > 256 * 1024) return unknown('Final answer is invalid or exceeds 256 KiB')
    const { id, text } = message.data
    return { state: 'completed', threadId: thread.thread.id, turnId: turn.id, effective: thread, approval: intent.approval, reconciled: !turnId, reconciliationRecorded, result: { itemId: id, text, sha256: createHash('sha256').update(text).digest('hex') } }
  }
  return { state: stale ? 'stale' : turn.status, threadId: thread.thread.id, turnId: turn.id, effective: thread, approval: intent.approval, reconciled: !turnId, reconciliationRecorded }
}

export async function dispatchApproval(root: string, job: Job, approvalRoot: string) {
  await assertPrivateDirectory(root)
  const existing = await readRecord(directory(root, job), 'intent')
  if (existing) {
    if (intentSchema.parse(existing).digest !== digest(job)) throw new Error('Job key conflict: immutable inputs changed')
    return undefined
  }
  return requireApproval(approvalRoot, job)
}

export async function dispatch(root: string, job: Job, rpc: Rpc, options: { approvalRoot?: string, deadline?: string, reference?: string } = {}) {
  const folder = directory(root, job)
  if (options.deadline && !await readRecord(folder, 'intent')) {
    if (!Number.isFinite(Date.parse(options.deadline)) || Date.parse(options.deadline) <= Date.now()) {
      return { state: 'blocked', phase: 'approval', reason: 'Start approval deadline expired; no start was sent' }
    }
  }
  let approval: Intent['approval']
  if (options.approvalRoot) {
    try {
      const receipt = await dispatchApproval(root, job, options.approvalRoot)
      if (receipt) approval = { jobDigest: receipt.jobDigest, reference: receipt.reference, expiresAt: receipt.expiresAt }
    }
    catch (error) { return { state: 'blocked', phase: 'approval', reason: String(error) } }
  }
  const intent: Intent = { schema: 'openape.codex-receipt/1', digest: digest(job), job, requestedAt: new Date().toISOString(), settleBy: new Date(Date.now() + 45000).toISOString(), ...(approval ? { approval } : {}), ...(options.deadline && options.reference ? { startApproval: { reference: options.reference, deadline: options.deadline } } : {}) }
  const won = await publishRecord(folder, 'intent', intent)
  if (!won) return { ...await status(root, job, rpc), skipped: true }
  let phase = approval ? 'approval' : 'thread/start'
  let threadId: string | undefined
  let turnId: string | undefined
  try {
    if (options.deadline && Date.parse(options.deadline) <= Date.now()) {
      phase = 'approval'
      throw new Error('Start approval deadline expired before thread/start; no start was sent')
    }
    if (approval && Date.parse(approval.expiresAt) <= Date.now()) throw new Error('Approval expired before thread/start; no start was sent')
    phase = 'thread/start'
    const raw = await rpc.call('thread/start', {
      cwd: job.cwd,
      model: job.model,
      approvalPolicy: job.approvalPolicy,
      sandbox: job.sandbox,
      ephemeral: false,
      allowProviderModelFallback: false,
    })
    const identity = z.object({ thread: z.object({ id: z.string().min(1) }) }).safeParse(raw)
    if (identity.success) threadId = identity.data.thread.id
    const thread = startSchema.parse(raw)
    threadId = thread.thread.id
    await publishRecord(folder, 'thread', thread)
    phase = 'configuration'
    const expectedSandbox = job.sandbox === 'read-only' ? 'readOnly' : 'dangerFullAccess'
    if (thread.model !== job.model || thread.cwd !== job.cwd || thread.approvalPolicy !== job.approvalPolicy || thread.sandbox.type !== expectedSandbox) {
      return { state: 'blocked', phase, threadId: thread.thread.id, reason: 'Effective execution configuration differs from the approved job' }
    }
    phase = 'turn/start'
    const result = z.object({ turn: turnSchema }).parse(await rpc.call('turn/start', {
      threadId: thread.thread.id,
      clientUserMessageId: intent.digest,
      input: [{ type: 'text', text: inputText(intent) }],
    }))
    turnId = result.turn.id
    await publishRecord(folder, 'turn', { id: result.turn.id })
    return { state: result.turn.status, threadId: thread.thread.id, turnId: result.turn.id, effective: thread, skipped: false }
  }
  catch (error) {
    const cause = error instanceof Error ? error.message : 'Unknown transport or persistence error'
    let failureRecorded = false
    let persistenceError: string | undefined
    try { failureRecorded = await publishRecord(folder, 'failure', { phase, cause, threadId, turnId }) }
    catch (error) { persistenceError = String(error) }
    return { state: phase === 'approval' && failureRecorded ? 'blocked' : 'unknown', phase, threadId, turnId, reason: cause, failureRecorded, persistenceError }
  }
}
