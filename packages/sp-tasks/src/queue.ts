import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import type { AgentTaskRow } from './schema'
import type { Artifact, Message, Task, TaskState } from './types'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { agentTasks } from './schema'
import { TERMINAL_STATES } from './types'

/** A Drizzle/libsql handle that includes the {@link agentTasks} table. */
export type SpTaskDb = LibSQLDatabase<{ agentTasks: typeof agentTasks }>

export const DEFAULT_LEASE_MS = 30_000

/** Thrown when a resolve does not hold a valid lease on the task. */
export class SpTaskError extends Error {}

// --- small A2A builders ---

export function dataMessage(data: unknown, role: 'user' | 'agent' = 'user'): Message {
  return { kind: 'message', messageId: randomUUID(), role, parts: [{ kind: 'data', data }] }
}
export function textMessage(text: string, role: 'user' | 'agent' = 'user'): Message {
  return { kind: 'message', messageId: randomUUID(), role, parts: [{ kind: 'text', text }] }
}
export function dataArtifact(data: unknown, name?: string): Artifact {
  return { artifactId: randomUUID(), name, parts: [{ kind: 'data', data }] }
}
export function textArtifact(text: string, name?: string): Artifact {
  return { artifactId: randomUUID(), name, parts: [{ kind: 'text', text }] }
}

function rowToTask(row: AgentTaskRow): Task {
  return {
    kind: 'task',
    id: row.id,
    contextId: row.contextId,
    status: { state: row.state },
    history: JSON.parse(row.history) as Message[],
    artifacts: JSON.parse(row.artifacts) as Artifact[],
    metadata: {
      type: row.type,
      assignee: row.assignee,
      leaseUntil: row.leaseUntil,
      deliveryCount: row.deliveryCount,
    },
  }
}

async function getRow(db: SpTaskDb, id: string): Promise<AgentTaskRow | null> {
  const row = await db.select().from(agentTasks).where(eq(agentTasks.id, id)).get()
  return row ?? null
}

/** Add a new task to the queue in state `submitted`; its input is `message` (A2A history[0]). */
export async function enqueueTask(
  db: SpTaskDb,
  opts: { id?: string, type: string, message: Message, contextId?: string, now: number },
): Promise<Task> {
  const id = opts.id ?? randomUUID()
  const contextId = opts.contextId ?? randomUUID()
  const message: Message = { ...opts.message, taskId: id, contextId }
  await db.insert(agentTasks).values({
    id,
    contextId,
    type: opts.type,
    state: 'submitted',
    history: JSON.stringify([message]),
    artifacts: '[]',
    deliveryCount: 0,
    createdAt: opts.now,
    updatedAt: opts.now,
  })
  return {
    kind: 'task',
    id,
    contextId,
    status: { state: 'submitted' },
    history: [message],
    artifacts: [],
    metadata: { type: opts.type, assignee: null, leaseUntil: null, deliveryCount: 0 },
  }
}

/**
 * SQS-style atomic claim: lease the oldest `submitted` task (or a `working` one
 * whose lease has expired) to `assignee` for `leaseMs`, bumping `deliveryCount`.
 * Returns `null` when nothing is claimable. The single `UPDATE … WHERE id =
 * (SELECT … LIMIT 1) RETURNING` statement is atomic, so two concurrent polls
 * cannot claim the same task.
 */
export async function leaseNextTask(
  db: SpTaskDb,
  opts: { assignee: string, leaseMs: number, now: number },
): Promise<Task | null> {
  const rows = await db
    .update(agentTasks)
    .set({
      state: 'working',
      assignee: opts.assignee,
      leaseUntil: opts.now + opts.leaseMs,
      deliveryCount: sql`${agentTasks.deliveryCount} + 1`,
      updatedAt: opts.now,
    })
    .where(sql`${agentTasks.id} = (
      SELECT id FROM agent_tasks
      WHERE state = 'submitted' OR (state = 'working' AND lease_until < ${opts.now})
      ORDER BY created_at ASC
      LIMIT 1
    )`)
    .returning()
  const row = rows[0]
  return row ? rowToTask(row) : null
}

/**
 * Apply a worker's update to a task it holds the lease on. A non-terminal
 * `state` (e.g. `working`) is a progress update: it appends `artifact`, extends
 * the lease (ChangeMessageVisibility) and keeps the task assigned. A terminal
 * `state` finalizes it and releases the lease (DeleteMessage). Throws if the
 * caller is not the current lease-holder or the lease has expired.
 */
export async function resolveTask(
  db: SpTaskDb,
  opts: {
    id: string
    assignee: string
    state: TaskState
    artifact?: Artifact
    statusMessage?: Message
    leaseMs?: number
    now: number
  },
): Promise<Task> {
  const existing = await getRow(db, opts.id)
  if (!existing)
    throw new SpTaskError(`task ${opts.id} not found`)
  if (existing.assignee !== opts.assignee || existing.leaseUntil == null || opts.now > existing.leaseUntil)
    throw new SpTaskError(`stale or invalid lease for task ${opts.id}`)

  const artifacts = JSON.parse(existing.artifacts) as Artifact[]
  if (opts.artifact)
    artifacts.push(opts.artifact)
  const history = JSON.parse(existing.history) as Message[]
  if (opts.statusMessage)
    history.push(opts.statusMessage)

  const terminal = TERMINAL_STATES.includes(opts.state)
  const leaseUntil = terminal ? null : opts.now + (opts.leaseMs ?? DEFAULT_LEASE_MS)
  const assignee = terminal ? null : opts.assignee

  await db
    .update(agentTasks)
    .set({
      state: opts.state,
      artifacts: JSON.stringify(artifacts),
      history: JSON.stringify(history),
      assignee,
      leaseUntil,
      updatedAt: opts.now,
    })
    .where(eq(agentTasks.id, opts.id))

  return rowToTask({
    ...existing,
    state: opts.state,
    artifacts: JSON.stringify(artifacts),
    history: JSON.stringify(history),
    assignee,
    leaseUntil,
    updatedAt: opts.now,
  })
}

export async function getTask(db: SpTaskDb, id: string): Promise<Task | null> {
  const row = await getRow(db, id)
  return row ? rowToTask(row) : null
}
