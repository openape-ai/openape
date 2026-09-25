// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, expect, it } from 'vitest'
import { runtimeReference, serviceQueueExample } from '../../src/worker/master/reference'

interface Request { url: string, method: string, key?: string, body?: string, receipt?: string }
interface Reply { status: number, headers: Record<string, string>, body: string, receipt?: { sha256: string, bytes: number } }

const root = mkdtempSync(join(tmpdir(), 'pods-service-queue-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const file = join(root, 'service-queue.mjs'); writeFileSync(file, serviceQueueExample)
const loaded = import(pathToFileURL(file).href) as Promise<{ run: (context: unknown) => Promise<{ status: string, summary: string, gapIds: string[] }> }>

// Mirrors the runtime contract: effects with a known key replay their stored digest receipt.
function service(tasks: unknown[], pendingBody?: string) {
  const ledger = new Map<string, Reply>(); const sent: Request[] = []; let agentCalls = 0
  const context = (runId = 'run-1') => ({
    input: { runId, checkpointRevision: 0, checkpoint: {}, eventIds: [] },
    variables: { tasks_url: 'https://service.example/api/agent/tasks' },
    progress: { commit: async () => ({ revision: 1 }) },
    agent: { run: async () => { agentCalls++; return { threadId: 't', response: '```json\n{"ok":true}\n```' } } },
    http: { request: async (request: Request): Promise<Reply> => {
      if (request.method === 'GET') return { status: 200, headers: {}, body: pendingBody ?? JSON.stringify({ pending: tasks.length }) }
      const stored = ledger.get(request.key!)
      if (stored) return stored
      sent.push(request)
      const body = request.url.endsWith('/next') ? JSON.stringify({ task: tasks.shift() ?? null }) : '{"task":{"status":{"state":"completed"}}}'
      ledger.set(request.key!, { status: 200, headers: {}, body: '', receipt: { sha256: 'digest', bytes: body.length } })
      return { status: 200, headers: {}, body }
    } },
  })
  return { context, sent, tasks, agentCalls: () => agentCalls }
}
const task = { id: 'task-1', metadata: { deliveryCount: 1 }, history: [{ parts: [{ kind: 'data', data: { systemPrompt: 'Answer as JSON', userMessage: 'Hello' } }] }] }

it('publishes the service-queue pattern in runtime help', () => {
  expect(runtimeReference.patterns.serviceQueue.example).toBe(serviceQueueExample)
})

it('checks an empty queue without a claim, model call or receipt', async () => {
  const { run } = await loaded; const queue = service([])
  expect(await run(queue.context())).toMatchObject({ status: 'completed', summary: 'Queue empty; no model call' })
  expect([queue.sent.length, queue.agentCalls()]).toEqual([0, 0])
})

it('answers a claimed task once and a retried run replays its claim receipt without a second delivery', async () => {
  const { run } = await loaded; const queue = service([task])
  expect((await run(queue.context())).summary).toBe('task-1: completed')
  expect(queue.agentCalls()).toBe(1)
  const resolve = queue.sent.find(request => request.url.endsWith('/resolve'))!
  expect([resolve.key, resolve.receipt, JSON.parse(resolve.body!).artifact.parts[0].text]).toEqual(['resolve:task-1:1', 'digest', '{"ok":true}'])
  queue.tasks.push(task)
  expect((await run(queue.context())).summary).toBe('No claimable task at claim time')
  expect(queue.sent.filter(request => request.url.endsWith('/resolve'))).toHaveLength(1)
  expect(queue.agentCalls()).toBe(1)
})

it('reports an invalid pending response as a committed gap, as synthetic validation requires', async () => {
  const { run } = await loaded
  const result = await run(service([], '{}').context())
  expect(result).toMatchObject({ status: 'completedWithGaps', gapIds: ['pending-run-1'] })
})
