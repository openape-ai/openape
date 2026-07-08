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
const agentPolls = new Map<string, number>() // owner → last poll ts

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

// Presence: the tasks endpoints call this on every authed poll, so /api/chat
// knows a live brain is listening and can wait for it instead of mocking early.
export function markAgentPoll(owner: string): void {
  agentPolls.set(owner, Date.now())
}

export function agentRecentlyActive(owner: string, withinMs = 20000): boolean {
  const t = agentPolls.get(owner)
  return t !== undefined && Date.now() - t < withinMs
}

export function cleanup(id: string): void {
  tasks.delete(id)
}
