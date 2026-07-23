// In-process task queue in the sp-tasks shape: /api/chat enqueues an `llm` task
// (systemPrompt + userMessage), an agent claims it via GetNextTask, posts optional
// progress + a terminal result via ResolveTask, and /api/chat relays it to the browser.
// ponytail: in-memory, single-replica, sp-tasks-*shaped* (not the real @openape/sp-tasks
// package yet). The wire matches what a stock ape-agent consumes/produces (verified M0),
// so the real worker serves it unmodified once auth is DDISA (M2).

export type TaskState = 'submitted' | 'working' | 'completed' | 'failed' | 'deferred' | 'input-required'

export interface QueueTask {
  id: string
  company: string
  owner: string
  systemPrompt: string
  userMessage: string
  claimed: boolean
  state: TaskState
  progress: string[] // intermediate "thinking" artifacts
  answer: string // terminal artifact text
  createdAt: number
  notBefore?: number
  // input-required: the agent's open question to the owner (answerTask resumes).
  question?: string
  options?: string[]
  askedAt?: number
  // chat attachments the worker downloads into its scratch dir
  files?: { id: string, mime: string, name: string }[]
}

const tasks = new Map<string, QueueTask>()
const pending: string[] = []
const agentPolls = new Map<string, AgentBeat>() // owner → last check-in

let seq = 0
function makeId(): string {
  seq += 1
  return `t${Date.now()}-${seq}`
}

const TASK_TTL_MS = 30 * 60_000
// An open question waits for a human — hours, not minutes. Same window as the
// DB prune in task-store so memory and durability agree on a task's lifetime.
const ASK_TTL_MS = 7 * 24 * 60 * 60_000
function gcStaleTasks(): void {
  const now = Date.now()
  for (const [id, t] of tasks) {
    const terminal = t.state === 'completed' || t.state === 'failed'
    const ttl = t.state === 'input-required' ? ASK_TTL_MS : TASK_TTL_MS
    if (terminal || now - t.createdAt > ttl) tasks.delete(id)
  }
}

export function enqueue(company: string, systemPrompt: string, userMessage: string, owner = '', files?: { id: string, mime: string, name: string }[]): { id: string } {
  gcStaleTasks()
  const task: QueueTask = {
    id: makeId(),
    company,
    owner,
    systemPrompt,
    userMessage,
    claimed: false,
    state: 'submitted',
    progress: [],
    answer: '',
    createdAt: Date.now(),
    files: files?.length ? files : undefined,
  }
  tasks.set(task.id, task)
  pending.push(task.id)
  return { id: task.id }
}

// Put a persisted task back into the queue with its ORIGINAL id (used by the
// boot rehydrate after a restart). Fresh submitted state — the worker re-runs it
// from scratch; its original id keeps removeTask() matching the DB row.
export function restoreTask(t: { id: string, company: string, owner: string, systemPrompt: string, userMessage: string, createdAt: number, notBefore?: number, lastNote?: string, question?: string, options?: string[], askedAt?: number, files?: { id: string, mime: string, name: string }[] }): void {
  if (tasks.has(t.id)) return
  // A persisted open question comes back AS the question — waiting for the
  // owner's answer, not re-offered to the worker.
  const asking = Boolean(t.question)
  tasks.set(t.id, { ...t, claimed: false, state: asking ? 'input-required' : 'submitted', progress: t.lastNote ? [t.lastNote] : [], answer: '' })
  if (!asking) pending.push(t.id)
}

// Owner-bound: an agent only ever claims tasks whose owner matches its own
// DDISA identity — the per-user security + routing boundary (multi-user ready).
export function claimNext(owner: string): QueueTask | null {
  for (let i = 0; i < pending.length; i++) {
    const task = tasks.get(pending[i]!)
    if (!task) { pending.splice(i, 1); i--; continue }
    if (task.owner === owner && !task.claimed && task.state === 'submitted' &&
      (!task.notBefore || Date.now() >= task.notBefore)) {
      pending.splice(i, 1)
      task.claimed = true
      task.state = 'working'
      return task
    }
  }
  return null
}

export function getTask(id: string): QueueTask | undefined {
  return tasks.get(id)
}

export function isClaimed(id: string): boolean {
  return tasks.get(id)?.claimed ?? false
}

export function isTerminal(id: string): boolean {
  const s = tasks.get(id)?.state
  return s === 'completed' || s === 'failed'
}

export function addProgress(id: string, text: string): boolean {
  const task = tasks.get(id)
  if (!task || isTerminal(id)) return false
  task.progress.push(text)
  return true
}

/** Apply a ResolveTask: terminal state sets the answer; `working` adds a progress note. */
export function resolve(id: string, state: TaskState, text: string, owner: string, retryInMs?: number, ask?: { question: string, options: string[] }): boolean {
  const task = tasks.get(id)
  if (!task || task.owner !== owner) return false
  if (state === 'completed' || state === 'failed') {
    task.state = state
    task.answer = text
  }
  else if (state === 'deferred') {
    task.state = 'submitted'
    task.claimed = false
    task.notBefore = Date.now() + (retryInMs ?? 0)
    if (text) task.progress.push(text)
    if (id && !pending.includes(id)) pending.push(id)
  }
  else if (state === 'input-required') {
    // The agent pauses this task on a question; answerTask() resumes it. Not in
    // `pending` — claimNext must not hand it out while the owner deliberates.
    task.state = 'input-required'
    task.claimed = false
    task.question = ask?.question ?? ''
    task.options = ask?.options ?? []
    task.askedAt = Date.now()
    if (text) task.progress.push(text)
  }
  else if (text) {
    task.progress.push(text)
  }
  return true
}

/** The owner answers an open question: the SAME task resumes with the choice appended. */
export function answerTask(id: string, owner: string, choice: string): boolean {
  const task = tasks.get(id)
  if (!task || task.owner !== owner || task.state !== 'input-required') return false
  task.userMessage += `\n\n[Rückfrage] ${task.question}\n[Antwort] ${choice}`
  task.progress.push(`Antwort des Owners: ${choice}`)
  task.state = 'submitted'
  task.claimed = false
  task.question = undefined
  task.options = undefined
  task.askedAt = undefined
  if (!pending.includes(id)) pending.push(id)
  return true
}

export function abort(id: string): void {
  const task = tasks.get(id)
  if (task && !isTerminal(id)) task.state = 'failed'
}

// Presence model. Each authed poll/heartbeat is a check-in that carries the
// agent's OWN promise of when it will next check in (nextPollInMs): a few
// seconds while it bursts, its wake delay (~60s) once it goes to sleep between
// bursts. From that single number the cockpit derives the real agent state
// without guessing — no mock over a live-but-sleeping brain.
export type AgentMode = 'offline' | 'idle' | 'active' | 'working'
interface AgentBeat { at: number, nextPollInMs: number }

const ACTIVE_MAX_MS = 20000 // a promised next poll this soon == actively bursting
const OFFLINE_GRACE_MS = 20000 // slack past the promised next poll before "offline"
const DEFAULT_NEXT_POLL_MS = 12000 // a bare poll with no promise: assume it's bursting

export function markAgentPoll(owner: string, nextPollInMs?: number): void {
  const prev = agentPolls.get(owner)
  agentPolls.set(owner, {
    at: Date.now(),
    nextPollInMs: nextPollInMs ?? prev?.nextPollInMs ?? DEFAULT_NEXT_POLL_MS,
  })
}

// Doctor report — the worker resolves each declared CLI via `command -v` in
// its REAL environment (launchd PATH, not the owner's login shell) and sends
// the result with a heartbeat. In-memory like agentPolls: stale after a worker
// restart is fine, the next doctor run overwrites.
const agentDoctors = new Map<string, Record<string, boolean>>() // owner → cli → found

export function markAgentDoctor(owner: string, report: Record<string, boolean>): void {
  agentDoctors.set(owner, report)
}

export function missingTools(owner: string, scope?: Set<string>): string[] {
  const report = agentDoctors.get(owner)
  if (!report) return []
  return Object.keys(report).filter(cli => !report[cli] && (!scope || scope.has(cli))).sort()
}

function ownerHasOpenTask(owner: string): boolean {
  for (const t of tasks.values()) {
    if (t.owner === owner && t.claimed && t.state === 'working') return true
  }
  return false
}

export interface AgentStatus { mode: AgentMode, nextPollInSec: number | null, missingTools: string[] }

export function agentStatus(owner: string, toolScope?: Set<string>): AgentStatus {
  const missing = missingTools(owner, toolScope)
  const b = agentPolls.get(owner)
  if (!b) return { mode: 'offline', nextPollInSec: null, missingTools: missing }
  const now = Date.now()
  const nextPollAt = b.at + b.nextPollInMs
  if (now > nextPollAt + OFFLINE_GRACE_MS) return { mode: 'offline', nextPollInSec: null, missingTools: missing }
  if (ownerHasOpenTask(owner)) return { mode: 'working', nextPollInSec: null, missingTools: missing }
  if (b.nextPollInMs <= ACTIVE_MAX_MS) return { mode: 'active', nextPollInSec: null, missingTools: missing }
  return { mode: 'idle', nextPollInSec: Math.max(0, Math.ceil((nextPollAt - now) / 1000)), missingTools: missing }
}

// A brain is "present" (not offline) — kept for callers that only need the binary.
export function agentRecentlyActive(owner: string): boolean {
  return agentStatus(owner).mode !== 'offline'
}

export function cleanup(id: string): void {
  tasks.delete(id)
}
