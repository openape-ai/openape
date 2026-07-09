// In-process task queue in the sp-tasks shape: /api/chat enqueues an `llm` task
// (systemPrompt + userMessage), an agent claims it via GetNextTask, posts optional
// progress + a terminal result via ResolveTask, and /api/chat relays it to the browser.
// ponytail: in-memory, single-replica, sp-tasks-*shaped* (not the real @openape/sp-tasks
// package yet). The wire matches what a stock ape-agent consumes/produces (verified M0),
// so the real worker serves it unmodified once auth is DDISA (M2).

export type TaskState = 'submitted' | 'working' | 'completed' | 'failed'

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
}

const tasks = new Map<string, QueueTask>()
const pending: string[] = []
const agentPolls = new Map<string, AgentBeat>() // owner → last check-in

let seq = 0
function makeId(): string {
  seq += 1
  return `t${Date.now()}-${seq}`
}

export function enqueue(company: string, systemPrompt: string, userMessage: string, owner = ''): { id: string } {
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
  }
  tasks.set(task.id, task)
  pending.push(task.id)
  return { id: task.id }
}

// Owner-bound: an agent only ever claims tasks whose owner matches its own
// DDISA identity — the per-user security + routing boundary (multi-user ready).
export function claimNext(owner: string): QueueTask | null {
  for (let i = 0; i < pending.length; i++) {
    const task = tasks.get(pending[i]!)
    if (!task) { pending.splice(i, 1); i--; continue }
    if (task.owner === owner && !task.claimed && task.state === 'submitted') {
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
export function resolve(id: string, state: TaskState, text: string, owner: string): boolean {
  const task = tasks.get(id)
  if (!task || task.owner !== owner) return false
  if (state === 'completed' || state === 'failed') {
    task.state = state
    task.answer = text
  }
  else if (text) {
    task.progress.push(text)
  }
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

function ownerHasOpenTask(owner: string): boolean {
  for (const t of tasks.values()) {
    if (t.owner === owner && t.claimed && t.state === 'working') return true
  }
  return false
}

export interface AgentStatus { mode: AgentMode, nextPollInSec: number | null }

export function agentStatus(owner: string): AgentStatus {
  const b = agentPolls.get(owner)
  if (!b) return { mode: 'offline', nextPollInSec: null }
  const now = Date.now()
  const nextPollAt = b.at + b.nextPollInMs
  if (now > nextPollAt + OFFLINE_GRACE_MS) return { mode: 'offline', nextPollInSec: null }
  if (ownerHasOpenTask(owner)) return { mode: 'working', nextPollInSec: null }
  if (b.nextPollInMs <= ACTIVE_MAX_MS) return { mode: 'active', nextPollInSec: null }
  return { mode: 'idle', nextPollInSec: Math.max(0, Math.ceil((nextPollAt - now) / 1000)) }
}

// A brain is "present" (not offline) — kept for callers that only need the binary.
export function agentRecentlyActive(owner: string): boolean {
  return agentStatus(owner).mode !== 'offline'
}

export function cleanup(id: string): void {
  tasks.delete(id)
}
