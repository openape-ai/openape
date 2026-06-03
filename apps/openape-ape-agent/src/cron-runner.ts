// Cron task runner inside the chat-bridge daemon.
//
// Why in-process (not separate processes per task): the bridge already
// owns the agent's WebSocket connection, the LLM-config resolution,
// and the LiteLLM env. Spawning a fresh process per task fire would
// duplicate every one of those. So we tick the cron in here instead —
// every 60s, read the cached task specs, fire any whose cron expression
// matches the current minute, post the streamed result back to the owner
// as a DM.
//
// REMOVE-AFTER: cutover-verified (see MIGRATION-mac-to-docker.md)
// The ~/.openape/agent/tasks/ cache dir is a Mac-era path. Docker nests
// write it into the container's home dir which works, but the canonical
// location post-cutover should be /var/lib/openape/agent/tasks/. Defer
// until the Mac path is confirmed unused.
//
// Cron subset: same as the troop SP enforces — `*`, `N`, `*/N`. No
// lists, no ranges. Match is evaluated minute-by-minute against the
// local time at the moment the tick fires, not against an absolute
// schedule grid — drift across reboots / pause is fine, no missed
// fires get replayed.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RuntimeConfig } from '@openape/apes'
import { runApeShell, runLoop, taskTools } from '@openape/apes'
import type { ChatBackend } from './chat-api'

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
  // Deterministic tasks (e.g. the coding-agent's issue poll): when set,
  // the runner executes this command via the gated ape-shell path
  // instead of an LLM runLoop — no model round-trip just to fire a fixed
  // command. Used by the coding-agent recipe's schedule to run
  // `apes agents code --poll-label …`.
  command?: string
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

// Render a command task's result keeping BOTH streams (tailed, so the
// operative error — usually last — survives the cap). `stdout || stderr`
// alone hid failures whose only signal was on stderr.
function composeTaskOutput(command: string, exitCode: number, stdout: string, stderr: string): string {
  const tail = (s: string, n: number): string => (s.length > n ? `…${s.slice(-n)}` : s)
  const parts = [`\`${command}\` exited ${exitCode}`]
  const out = stdout.trim()
  const err = stderr.trim()
  if (out) parts.push(`stdout:\n${tail(out, 2500)}`)
  if (err) parts.push(`stderr:\n${tail(err, 2500)}`)
  return parts.join('\n\n')
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
  /**
   * Resolved at bridge boot — model + LiteLLM proxy details. The
   * cron runner shares it with chat threads.
   */
  runtimeConfig: RuntimeConfig
  chat: ChatBackend
  /** Owner email — where DMs go. Resolved from the contacts list at fire time. */
  ownerEmail: string
  log: (line: string) => void
  /**
   * Troop SP URL (default: https://troop.openape.ai) — used to record
   * run history per fire so the troop owner UI can show status + the
   * final_message under "Recent runs".
   */
  troopUrl: string
  /**
   * Same Bearer the bridge uses for chat — works for troop because
   * the agent JWT is acceptable on both SPs (no per-SP audience check).
   */
  bearer: () => Promise<string>
}

export class CronRunner {
  private timer: NodeJS.Timeout | undefined
  private lastTickedMinute: string | undefined
  /**
   * Sessions still streaming — keeps accumulated text, destination
   * room, plus the troop run-id we created at fire time so we can
   * PATCH it with status + step_count when the run ends.
   */
  private pending = new Map<string, {
    taskId: string
    taskName: string
    accumulated: string
    // Undefined for headless command tasks that fire with no owner room —
    // they still run and record a troop run, they just skip the DM.
    roomId?: string
    status: 'ok' | 'error' | 'pending'
    runId?: string
  }>()

  /**
   * taskId → chatThreadId. Loaded from disk on construct, persisted
   * after each new thread allocation. All runs of the same task post
   * into the same thread so the chat history stays coherent.
   */
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
    // Phase A simplification: no RPC subprocess to attach to. Each
    // task fire calls runLoop directly and updates `pending` from
    // the run's handlers — see fireTask below.
    // First tick after a small delay — gives chat a moment to settle.
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL_MS)
    // And one immediate tick so cron jobs that match the current minute
    // don't have to wait until the next minute boundary.
    setTimeout(() => this.tick(), 5_000).unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  /**
   * Fire any tasks whose cron matches the current minute. Idempotent
   * within a single minute — we de-dup by floored-minute-string.
   */
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
    // A deterministic command task runs headless — it drives its own work
    // (e.g. opening a PR) and doesn't need an owner room to exist. Only
    // LLM/chat tasks require a room to DM their result into. When a room
    // IS present we still post the command's summary there as a courtesy.
    if (!spec.command && !room?.roomId) {
      this.deps.log(`task ${spec.taskId} fired but no active owner room — skipping DM (accept the contact in chat)`)
      return
    }
    // Same session_id across runs of one task → the runtime sees prior
    // turns as conversation context (within its session-evict TTL).
    // Same chat-thread-id → all runs land as messages in one thread,
    // not as N independent DMs at the top of the inbox.
    const sessionId = `task:${spec.taskId}`

    // Open a run record in troop FIRST so the UI's "Recent runs" list
    // shows the run as 'running' immediately. Best-effort — if troop is
    // down we still execute the task and post the DM; just no row.
    let runId: string | undefined
    try {
      const res = await fetch(`${this.deps.troopUrl}/api/agents/me/runs`, {
        method: 'POST',
        headers: {
          'Authorization': await this.deps.bearer(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ task_id: spec.taskId }),
      })
      if (res.ok) {
        const data = await res.json() as { id: string }
        runId = data.id
      }
      else {
        this.deps.log(`troop startRun ${spec.taskId} failed: ${res.status}`)
      }
    }
    catch (err) {
      this.deps.log(`troop startRun ${spec.taskId} error: ${err instanceof Error ? err.message : String(err)}`)
    }

    this.pending.set(sessionId, { taskId: spec.taskId, taskName: spec.name, accumulated: '', roomId: room?.roomId ?? undefined, status: 'pending', runId })
    this.deps.log(`task ${spec.taskId} fired (session=${sessionId}, run=${runId ?? 'no-troop'})`)

    // Run the agent loop in-process. No subprocess, no RPC.
    void this.runTask(sessionId, systemPrompt, spec)
  }

  private async runTask(
    sessionId: string,
    systemPrompt: string,
    spec: { tools: string[], maxSteps: number, userPrompt: string, command?: string },
  ): Promise<void> {
    // Deterministic command task (e.g. coding-agent poll) — run it via
    // the gated ape-shell path, no LLM round-trip. The command itself
    // (apes agents code …) drives the LLM coding loop internally.
    if (spec.command) {
      try {
        const res = await runApeShell(spec.command, 30 * 60 * 1000)
        const turn = this.pending.get(sessionId)
        if (!turn) return
        turn.status = res.exit_code === 0 ? 'ok' : 'error'
        // Keep BOTH streams: a command can fail with everything on stderr
        // (e.g. a thrown CliError) while stdout holds only early progress —
        // `stdout || stderr` would then hide the actual failure. Show the
        // tail so the operative error (usually last) survives the cap.
        turn.accumulated = composeTaskOutput(spec.command, res.exit_code, res.stdout, res.stderr)
        await this.finaliseRun(turn, 1)
        await this.postResult(sessionId, turn)
        this.pending.delete(sessionId)
      }
      catch (err) {
        const turn = this.pending.get(sessionId)
        if (!turn) return
        turn.status = 'error'
        turn.accumulated = `(command error: ${err instanceof Error ? err.message : String(err)})`
        await this.finaliseRun(turn, 0)
        await this.postResult(sessionId, turn)
        this.pending.delete(sessionId)
      }
      return
    }
    try {
      const result = await runLoop({
        config: this.deps.runtimeConfig,
        systemPrompt,
        userMessage: spec.userPrompt,
        tools: taskTools(spec.tools),
        maxSteps: spec.maxSteps,
        handlers: {
          onTextDelta: (delta) => {
            const turn = this.pending.get(sessionId)
            if (turn) turn.accumulated += delta
          },
        },
      })
      const turn = this.pending.get(sessionId)
      if (!turn) return
      turn.status = result.status === 'error' ? 'error' : 'ok'
      await this.finaliseRun(turn, result.stepCount)
      await this.postResult(sessionId, turn)
      this.pending.delete(sessionId)
    }
    catch (err) {
      const turn = this.pending.get(sessionId)
      if (!turn) return
      turn.status = 'error'
      turn.accumulated = `(runtime error: ${err instanceof Error ? err.message : String(err)})`
      await this.finaliseRun(turn, 0)
      await this.postResult(sessionId, turn)
      this.pending.delete(sessionId)
    }
  }

  private async finaliseRun(turn: { runId?: string, status: 'ok' | 'error' | 'pending', accumulated: string }, stepCount: number): Promise<void> {
    if (!turn.runId) return
    try {
      await fetch(`${this.deps.troopUrl}/api/agents/me/runs/${encodeURIComponent(turn.runId)}`, {
        method: 'PATCH',
        headers: {
          'Authorization': await this.deps.bearer(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: turn.status === 'pending' ? 'error' : turn.status,
          final_message: turn.accumulated.slice(0, 4000),
          step_count: stepCount,
          trace: [],
        }),
      })
    }
    catch (err) {
      this.deps.log(`troop finaliseRun failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async postResult(sid: string, turn: { taskId: string, taskName: string, accumulated: string, roomId?: string, status: 'ok' | 'error' | 'pending' }): Promise<void> {
    // Headless command task with no owner room — nothing to DM into. The
    // run is already recorded in troop; the work reports through its own
    // channel (e.g. a PR), so just log and move on.
    if (!turn.roomId) {
      this.deps.log(`task ${turn.taskId} ran headless (no owner room) — DM skipped`)
      return
    }
    const roomId = turn.roomId
    const prefix = turn.status === 'error' ? '❌' : '✅'
    const text = turn.accumulated.trim() || (turn.status === 'error' ? '(crashed)' : '(no output)')
    const body = `${prefix} *${turn.taskName}*\n\n${text}`.slice(0, 9000)
    let threadId = this.taskThreads.get(turn.taskId)
    // First run of this task — explicitly create a new chat thread
    // named after the task so the chat sidebar gets a dedicated entry
    // (otherwise messages without thread_id land in the room's main
    // thread, fanning out everything into one stream).
    if (!threadId) {
      try {
        const created = await this.deps.chat.createThread(roomId, turn.taskName || turn.taskId)
        threadId = created.id
        this.taskThreads.set(turn.taskId, threadId)
        this.persistTaskThreads()
        this.deps.log(`task ${turn.taskId} thread created: ${threadId}`)
      }
      catch (err) {
        this.deps.log(`createThread failed for ${turn.taskId}, falling back to main thread: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    try {
      const posted = await this.deps.chat.postMessage(roomId, body, threadId ? { threadId } : {})
      this.deps.log(`task DM posted (session=${sid}, ${turn.accumulated.length} chars, thread=${posted.threadId})`)
    }
    catch (err) {
      this.deps.log(`task DM post failed (session=${sid}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
