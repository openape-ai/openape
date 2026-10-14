// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import { PodDatabase } from '../../src/worker/storage/database'
import { MasterTransport } from '../../src/worker/master/transport'
import { summarizeConversation } from '../../src/worker/master/summarize'

vi.mock('../../src/worker/master/transport', () => ({ MasterTransport: { start: vi.fn() } }))
const stores: PodDatabase[] = []
afterEach(() => { vi.mocked(MasterTransport.start).mockReset(); for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } })
function fixture() {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-description-model-'))); stores.push(store)
  const catalog = join(store.root, 'models.json'); writeFileSync(catalog, JSON.stringify({ models: [{ slug: 'fixture-model-a' }] }))
  return { store, runtime: { helper: '/unused', catalog } as AgentRuntime }
}

it('starts the description thread with the connected account default', async () => {
  const { store, runtime } = fixture(); const threads: string[] = []
  vi.mocked(MasterTransport.start).mockImplementation(async (_runtime, _root, _services, _register, notify) => ({
    thread: async (_runtime: AgentRuntime, _root: string, model: string) => { threads.push(model); return 'synthetic-thread' },
    request: async () => {
      notify({ method: 'turn/started', params: { threadId: 'synthetic-thread', turn: { id: 'turn' } } })
      notify({ method: 'item/completed', params: { threadId: 'synthetic-thread', turnId: 'turn', item: { type: 'agentMessage', text: JSON.stringify({ description: 'Checks mail hourly.' }) } } })
      notify({ method: 'turn/completed', params: { threadId: 'synthetic-thread', turn: { id: 'turn', status: 'completed' } } })
      return {}
    },
    close: async () => {},
  }) as unknown as MasterTransport)
  const description = await summarizeConversation(store, runtime, { provider: async () => new Response('{}'), model: async () => 'fixture-model-a' }, '{}', new AbortController().signal)
  expect(description).toBe('Checks mail hourly.')
  expect(threads).toEqual(['fixture-model-a'])
})

it('does not start the description model when the account default is missing from the bundled catalog', async () => {
  const { store, runtime } = fixture()
  await expect(summarizeConversation(store, runtime, { provider: async () => new Response('{}'), model: async () => 'fixture-model-newer' }, '{}', new AbortController().signal)).rejects.toThrow('is not in the bundled Codex model catalog')
  expect(MasterTransport.start).not.toHaveBeenCalled()
})
