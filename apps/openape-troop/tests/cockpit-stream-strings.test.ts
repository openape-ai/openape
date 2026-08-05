import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

// The SSE stream is read by browsers in every language, so it must carry stable
// codes the client translates — never a finished German sentence. These tests
// drive the real handler and read the wire.

let requestBody: Record<string, unknown> = {}
let currentOwner = ''

vi.mock('../server/utils/cockpit/auth', () => ({ cockpitOwner: vi.fn(async () => currentOwner) }))
vi.mock('../server/utils/cockpit/org-context', () => ({ buildOrgSystemPrompt: vi.fn(async () => 'system prompt') }))
vi.mock('../server/utils/cockpit/chat-store', () => ({ saveChatMessage: vi.fn(async () => ({})) }))
vi.mock('../server/utils/cockpit/file-store', () => ({
  resolveRefs: vi.fn(async (_owner: string, ids: string[]) => ids.map(id => ({ id, mime: 'image/png', name: `${id}.png` }))),
}))
vi.mock('../server/utils/cockpit/task-store', () => ({ saveTask: vi.fn(async () => {}) }))
vi.mock('../server/utils/cockpit/allowed-tools', () => ({ orgAllowedTools: vi.fn(async () => []) }))

// Nitro auto-imports the handler relies on.
const globals = globalThis as Record<string, unknown>
globals.defineEventHandler = (h: unknown) => h
globals.readBody = async () => requestBody
globals.setResponseHeaders = () => {}
globals.createError = (e: { statusMessage?: string }) => Object.assign(new Error(e.statusMessage ?? 'error'), e)

const handler = (await import('../server/api/cockpit/message.post')).default as unknown as (event: unknown) => Promise<ReadableStream<Uint8Array>>
const { saveChatMessage } = await import('../server/utils/cockpit/chat-store')
const { markAgentPoll } = await import('../server/utils/cockpit/queue')

interface WireEvent { k?: string, code?: string, text?: string, sec?: number, id?: string }

// Runs one request and returns everything the browser would see. The client is
// declared gone after the first chunk so the handler stops waiting for a brain.
async function streamOf(owner: string, body: Record<string, unknown>): Promise<WireEvent[]> {
  currentOwner = owner
  requestBody = body
  const req = new EventEmitter()
  const stream = await handler({ node: { req } })
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const events: WireEvent[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    for (const line of decoder.decode(value).split('\n')) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice('data: '.length)
      if (payload !== '[DONE]') events.push(JSON.parse(payload) as WireEvent)
    }
    req.emit('close')
  }
  return events
}

describe('cockpit message stream — codes, not sentences', () => {
  it('announces a sleeping Operator as a code with the countdown', async () => {
    markAgentPoll('asleep@x', 60_000)
    const events = await streamOf('asleep@x', { company: 'acme', messages: [{ role: 'user', content: 'hallo' }] })
    const wait = events.find(e => e.k === 'wait')
    expect(wait?.code).toBe('operator.asleep')
    expect(wait?.sec).toBeGreaterThan(0)
    expect(wait?.text).toBeUndefined()
    expect(JSON.stringify(events)).not.toContain('Ruhemodus')
  })

  it('announces a woken Operator as a code', async () => {
    markAgentPoll('awake@x', 3_000)
    const events = await streamOf('awake@x', { company: 'acme', messages: [{ role: 'user', content: 'hallo' }] })
    const think = events.find(e => e.k === 'think')
    expect(think?.code).toBe('operator.takingOver')
    expect(think?.text).toBeUndefined()
    expect(JSON.stringify(events)).not.toContain('übernimmt')
  })

  it('stores an attachment-only turn without a German placeholder', async () => {
    await streamOf('files@x', { company: 'acme', messages: [{ role: 'user', content: '' }], files: ['f1'] })
    expect(saveChatMessage).toHaveBeenCalledWith('acme', 'files@x', 'user', '', undefined, [{ id: 'f1', mime: 'image/png', name: 'f1.png' }])
  })
})
