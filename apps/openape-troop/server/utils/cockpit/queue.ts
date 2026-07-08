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
let lastAgentPollAt = 0

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

export function claimNext(): QueueTask | null {
  while (pending.length) {
    const task = tasks.get(pending.shift()!)
    if (task && !task.claimed && task.state === 'submitted') {
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
export function resolve(id: string, state: TaskState, text: string): boolean {
  const task = tasks.get(id)
  if (!task) return false
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
export function markAgentPoll(): void {
  lastAgentPollAt = Date.now()
}

export function agentRecentlyActive(withinMs = 20000): boolean {
  return lastAgentPollAt > 0 && Date.now() - lastAgentPollAt < withinMs
}

export function cleanup(id: string): void {
  tasks.delete(id)
}
