import { createClient } from '@libsql/client'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { beforeEach, describe, expect, it } from 'vitest'
import { dataMessage, enqueueTask, getTask, leaseNextTask, resolveTask, textArtifact } from '../src/queue'
import { agentTasks } from '../src/schema'

let db: ReturnType<typeof drizzle<{ agentTasks: typeof agentTasks }>>

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema: { agentTasks } })
  await db.run(sql`CREATE TABLE agent_tasks (
    id TEXT PRIMARY KEY,
    context_id TEXT NOT NULL,
    type TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'submitted',
    history TEXT NOT NULL DEFAULT '[]',
    artifacts TEXT NOT NULL DEFAULT '[]',
    assignee TEXT,
    lease_until INTEGER,
    delivery_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
})

describe('enqueueTask', () => {
  it('creates a submitted A2A task with the input message in history', async () => {
    const t = await enqueueTask(db, { type: 'extract', message: dataMessage({ projectId: 'p1' }), now: 100 })
    expect(t.kind).toBe('task')
    expect(t.status.state).toBe('submitted')
    expect(t.history).toHaveLength(1)
    expect(t.history[0]!.role).toBe('user')
    expect(t.artifacts).toEqual([])
    expect(t.contextId).toBeTruthy()
  })
})

describe('leaseNextTask (SQS-style atomic claim)', () => {
  it('leases the oldest submitted task as working+assignee', async () => {
    await enqueueTask(db, { id: 'a', type: 'x', message: dataMessage({ n: 1 }), now: 1 })
    const leased = await leaseNextTask(db, { assignee: 'agent@x', leaseMs: 1000, now: 10 })
    expect(leased?.id).toBe('a')
    expect(leased?.status.state).toBe('working')
    expect((await getTask(db, 'a'))?.status.state).toBe('working')
  })

  it('does not hand the same task to a second concurrent poll', async () => {
    await enqueueTask(db, { id: 'only', type: 'x', message: dataMessage({}), now: 1 })
    const first = await leaseNextTask(db, { assignee: 'a1', leaseMs: 1000, now: 10 })
    const second = await leaseNextTask(db, { assignee: 'a2', leaseMs: 1000, now: 11 })
    expect(first?.id).toBe('only')
    expect(second).toBeNull()
  })

  it('hands distinct tasks to successive polls in FIFO order', async () => {
    await enqueueTask(db, { id: 't1', type: 'x', message: dataMessage({}), now: 1 })
    await enqueueTask(db, { id: 't2', type: 'x', message: dataMessage({}), now: 2 })
    const a = await leaseNextTask(db, { assignee: 'a', leaseMs: 1000, now: 10 })
    const b = await leaseNextTask(db, { assignee: 'a', leaseMs: 1000, now: 11 })
    expect([a?.id, b?.id]).toEqual(['t1', 't2'])
  })

  it('re-leases a task whose lease expired and bumps deliveryCount', async () => {
    await enqueueTask(db, { id: 'x', type: 'x', message: dataMessage({}), now: 1 })
    await leaseNextTask(db, { assignee: 'dead', leaseMs: 100, now: 10 }) // lease until 110
    expect(await leaseNextTask(db, { assignee: 'b', leaseMs: 100, now: 50 })).toBeNull() // still leased
    const reclaimed = await leaseNextTask(db, { assignee: 'b', leaseMs: 100, now: 200 }) // expired
    expect(reclaimed?.id).toBe('x')
    expect(reclaimed?.metadata?.deliveryCount).toBe(2)
  })
})

describe('resolveTask', () => {
  it('progress (working) appends an artifact and keeps the task leased', async () => {
    await enqueueTask(db, { id: 'x', type: 'x', message: dataMessage({}), now: 1 })
    await leaseNextTask(db, { assignee: 'a', leaseMs: 100, now: 10 })
    const t = await resolveTask(db, { id: 'x', assignee: 'a', state: 'working', artifact: textArtifact('partial 1'), leaseMs: 100, now: 20 })
    expect(t.status.state).toBe('working')
    expect(t.artifacts).toHaveLength(1)
  })

  it('completed finalizes with a terminal state and the final artifact', async () => {
    await enqueueTask(db, { id: 'x', type: 'x', message: dataMessage({}), now: 1 })
    await leaseNextTask(db, { assignee: 'a', leaseMs: 100, now: 10 })
    const t = await resolveTask(db, { id: 'x', assignee: 'a', state: 'completed', artifact: textArtifact('done'), now: 20 })
    expect(t.status.state).toBe('completed')
    expect(t.artifacts.at(-1)?.parts[0]).toMatchObject({ kind: 'text', text: 'done' })
    expect((await getTask(db, 'x'))?.status.state).toBe('completed')
  })

  it('rejects a resolve from a non-lease-holder (stale receipt)', async () => {
    await enqueueTask(db, { id: 'x', type: 'x', message: dataMessage({}), now: 1 })
    await leaseNextTask(db, { assignee: 'a', leaseMs: 100, now: 10 })
    await expect(resolveTask(db, { id: 'x', assignee: 'intruder', state: 'completed', now: 20 })).rejects.toThrow()
  })

  it('rejects a resolve after the lease expired (task was re-queued)', async () => {
    await enqueueTask(db, { id: 'x', type: 'x', message: dataMessage({}), now: 1 })
    await leaseNextTask(db, { assignee: 'a', leaseMs: 100, now: 10 }) // until 110
    await expect(resolveTask(db, { id: 'x', assignee: 'a', state: 'completed', now: 200 })).rejects.toThrow()
  })
})
