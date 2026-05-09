// Cron task runner inside the chat-bridge daemon.
//
// Why in-process (not separate launchd plists per task): the bridge
// already owns the agent's WebSocket to chat.openape.ai, the
// `apes agents serve --rpc` subprocess, and the only LLM-config
// resolution. Spawning a fresh `apes agents run` per task fire would
// duplicate every one of those plus require a separate copy of the
// LiteLLM env that's already in the bridge's working directory. So
// we tick the cron in here instead — every 60s, read the cached
// task specs, fire any whose cron expression matches the current
// minute, post the streamed result back to the owner as a DM.
//
// Cron subset: same as the troop SP enforces — `*`, `N`, `*/N`. No
// lists, no ranges. Match is evaluated minute-by-minute against the
// local time at the moment the tick fires, not against an absolute
// schedule grid — drift across reboots / pause is fine, no missed
// fires get replayed.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ApesEvent, ApesRpcSession } from './apes-rpc'
import type { ChatApi } from './chat-api'

const TASK_CACHE_DIR = join(homedir(), '.openape', 'agent', 'tasks')
const AGENT_CONFIG_PATH = join(homedir(), '.openape', 'agent', 'agent.json')
// One chat thread per task — persisted so we don't fan out a new
// thread per run after every bridge restart. Layout:
// { "<taskId>": "<chatThreadId>", ... }.
const TASK_THREADS_PATH = join(homedir(), '.openape', 'agent', 'task-threads.json')
const TICK_INTERVAL_MS = 60_000

interface TaskSpec {
  taskId: string
  name: string
  cron: string
  userPrompt: string
  tools: string[]
  maxSteps: number
  enabled: boolean
}

interface CronExpr {
  minute: { type: 'any' } | { type: 'fixed', value: number } | { type: 'step', step: number }
  hour: { type: 'any' } | { type: 'fixed', value: number } | { type: 'step', step: number }
  dom: { type: 'any' } | { type: 'fixed', value: number }
  month: { type: 'any' } | { type: 'fixed', value: number }
  dow: { type: 'any' } | { type: 'fixed', value: number }
}

function parseField(token: string, range: [number, number], allowStep: boolean): CronExpr['minute'] | null {
  if (token === '*') return { type: 'any' }
  if (allowStep && token.startsWith('*/')) {
    const step = Number(token.slice(2))
    if (!Number.isInteger(step) || step < 1 || step > range[1]) return null
    return { type: 'step', step }
  }
  const n = Number(token)
  if (!Number.isInteger(n) || n < range[0] || n > range[1]) return null
  return { type: 'fixed', value: n }
}

export function parseCron(expr: string): CronExpr | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [m, h, dom, mo, dow] = parts as [string, string, string, string, string]
  const minute = parseField(m, [0, 59], true)
  const hour = parseField(h, [0, 23], true)
  const dayOfMonth = parseField(dom, [1, 31], false)
  const month = parseField(mo, [1, 12], false)
  const dayOfWeek = parseField(dow, [0, 7], false)
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null
  return {
    minute,
    hour,
    dom: dayOfMonth as CronExpr['dom'],
    month: month as CronExpr['month'],
    dow: dayOfWeek as CronExpr['dow'],
  }
}

function fieldMatches(field: CronExpr['minute'] | CronExpr['dom'], value: number): boolean {
  if (field.type === 'any') return true
  if (field.type === 'fixed') return field.value === value
  if (field.type === 'step') return value % field.step === 0
  return false
}

export function cronMatches(expr: CronExpr, now: Date): boolean {
  const dow = now.getDay() // 0 = Sun
  return (
    fieldMatches(expr.minute, now.getMinutes())
    && fieldMatches(expr.hour, now.getHours())
    && fieldMatches(expr.dom, now.getDate())
    && fieldMatches(expr.month, now.getMonth() + 1)
    // Cron's 7=Sunday → 0
    && (fieldMatches(expr.dow, dow) || (expr.dow.type === 'fixed' && expr.dow.value === 7 && dow === 0))
  )
}

function readTaskSpecs(): TaskSpec[] {
  if (!existsSync(TASK_CACHE_DIR)) return []
  const out: TaskSpec[] = []
  for (const entry of readdirSync(TASK_CACHE_DIR)) {
    if (!entry.endsWith('.json')) continue
    const path = join(TASK_CACHE_DIR, entry)
    try {
      const t = JSON.parse(readFileSync(path, 'utf8')) as TaskSpec
      if (t.taskId && t.cron && t.enabled !== false) out.push(t)
    }
    catch { /* skip malformed */ }
  }
  return out
}

function readSystemPrompt(): string {
  if (!existsSync(AGENT_CONFIG_PATH)) return ''
  try {
    const parsed = JSON.parse(readFileSync(AGENT_CONFIG_PATH, 'utf8')) as { systemPrompt?: string }
    return typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : ''
  }
  catch { return '' }
}

export interface CronRunnerDeps {
  rpc: () => ApesRpcSession
  chat: ChatApi
  /** Owner email — where DMs go. Resolved from the contacts list at fire time. */
  ownerEmail: string
  model: string
  log: (line: string) => void
}

export class CronRunner {
  private timer: NodeJS.Timeout | undefined
  private lastTickedMinute: string | undefined
  /** Sessions still streaming — keeps their accumulated text + the
   * destination room until 'done', when we post the final message. */
  private pending = new Map<string, { taskId: string, taskName: string, accumulated: string, roomId: string, status: 'ok' | 'error' | 'pending' }>()
  private detach: (() => void) | undefined
  /** taskId → chatThreadId. Loaded from disk on construct, persisted
   * after each new thread allocation. All runs of the same task post
   * into the same thread so the chat history stays coherent. */
  private taskThreads: Map<string, string> = new Map()

  constructor(private deps: CronRunnerDeps) {
    this.loadTaskThreads()
  }

  private loadTaskThreads(): void {
    if (!existsSync(TASK_THREADS_PATH)) return
    try {
      const parsed = JSON.parse(readFileSync(TASK_THREADS_PATH, 'utf8')) as Record<string, string>
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') this.taskThreads.set(k, v)
      }
    }
    catch { /* corrupt file — start fresh */ }
  }

  private persistTaskThreads(): void {
    try {
      const dir = join(homedir(), '.openape', 'agent')
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        TASK_THREADS_PATH,
        `${JSON.stringify(Object.fromEntries(this.taskThreads), null, 2)}\n`,
        { mode: 0o600 },
      )
    }
    catch (err) {
      this.deps.log(`task-threads persist failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  start(): void {
    if (this.timer) return
    this.detach = this.deps.rpc().on(event => this.onRpcEvent(event))
    // First tick after a small delay — gives chat a moment to settle.
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL_MS)
    // And one immediate tick so cron jobs that match the current minute
    // don't have to wait until the next minute boundary.
    setTimeout(() => this.tick(), 5_000).unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.detach?.()
    this.detach = undefined
  }

  /** Fire any tasks whose cron matches the current minute. Idempotent
   * within a single minute — we de-dup by floored-minute-string. */
  private async tick(): Promise<void> {
    const now = new Date()
    const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`
    if (this.lastTickedMinute === minuteKey) return
    this.lastTickedMinute = minuteKey

    const specs = readTaskSpecs()
    const systemPrompt = readSystemPrompt()
    for (const spec of specs) {
      const expr = parseCron(spec.cron)
      if (!expr) {
        this.deps.log(`task ${spec.taskId}: invalid cron "${spec.cron}" — skipping`)
        continue
      }
      if (!cronMatches(expr, now)) continue
      void this.fire(spec, systemPrompt).catch((err) => {
        this.deps.log(`task ${spec.taskId} fire failed: ${err instanceof Error ? err.message : String(err)}`)
      })
    }
  }

  private async fire(spec: TaskSpec, systemPrompt: string): Promise<void> {
    // Resolve the owner room each fire — owner could (re-)accept the
    // contact at any point, no point caching it.
    const contacts = await this.deps.chat.listContacts().catch(() => [])
    const ownerLower = this.deps.ownerEmail.toLowerCase()
    const room = contacts.find(c => c.peerEmail.toLowerCase() === ownerLower && c.connected && c.roomId)
    if (!room?.roomId) {
      this.deps.log(`task ${spec.taskId} fired but no active owner room — skipping DM (accept the contact in chat)`)
      return
    }
    // Same session_id across runs of one task → the runtime sees prior
    // turns as conversation context (within its session-evict TTL).
    // Same chat-thread-id → all runs land as messages in one thread,
    // not as N independent DMs at the top of the inbox.
    const sessionId = `task:${spec.taskId}`
    this.pending.set(sessionId, { taskId: spec.taskId, taskName: spec.name, accumulated: '', roomId: room.roomId, status: 'pending' })
    this.deps.log(`task ${spec.taskId} fired (session=${sessionId})`)

    // Make sure the rpc subprocess is alive — bridge keeps a single
    // shared one for chat threads + tasks alike.
    const rpc = this.deps.rpc()
    rpc.prompt({
      sessionId,
      systemPrompt,
      tools: spec.tools,
      maxSteps: spec.maxSteps,
      model: this.deps.model,
      userMsg: spec.userPrompt,
    })
  }

  private onRpcEvent(event: ApesEvent): void {
    const sid = event.session_id
    if (!sid || !sid.startsWith('task:')) return
    const turn = this.pending.get(sid)
    if (!turn) return
    switch (event.type) {
      case 'text_delta':
        if (typeof event.delta === 'string') turn.accumulated += event.delta
        break
      case 'done':
        turn.status = event.status === 'error' ? 'error' : 'ok'
        void this.postResult(sid, turn)
        this.pending.delete(sid)
        break
      case 'error':
        turn.status = 'error'
        turn.accumulated = `(runtime error: ${event.message ?? 'unknown'})`
        void this.postResult(sid, turn)
        this.pending.delete(sid)
        break
    }
  }

  private async postResult(sid: string, turn: { taskId: string, taskName: string, accumulated: string, roomId: string, status: 'ok' | 'error' | 'pending' }): Promise<void> {
    const prefix = turn.status === 'error' ? '❌' : '✅'
    const text = turn.accumulated.trim() || (turn.status === 'error' ? '(crashed)' : '(no output)')
    const body = `${prefix} *${turn.taskName}*\n\n${text}`.slice(0, 9000)
    const threadId = this.taskThreads.get(turn.taskId)
    try {
      const posted = await this.deps.chat.postMessage(turn.roomId, body, threadId ? { threadId } : {})
      // First run of this task — server allocated a fresh thread when
      // we posted without threadId. Cache + persist it so every
      // subsequent run lands in the same thread.
      if (!threadId && posted.threadId) {
        this.taskThreads.set(turn.taskId, posted.threadId)
        this.persistTaskThreads()
      }
      this.deps.log(`task DM posted (session=${sid}, ${turn.accumulated.length} chars, thread=${posted.threadId})`)
    }
    catch (err) {
      this.deps.log(`task DM post failed (session=${sid}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
