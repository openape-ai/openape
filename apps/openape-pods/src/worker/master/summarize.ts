import { join } from 'node:path'
import type { AgentRuntime } from '../agent/executor'
import type { AgentGatewayServices } from '../agent/gateway'
import type { PodDatabase } from '../storage/database'
import { inspectDomainRecords } from '../recovery/domains'
import { MasterTransport } from './transport'

export async function summarizeConversation(store: PodDatabase, runtime: AgentRuntime, provider: AgentGatewayServices['provider'] | undefined, input: string, signal: AbortSignal): Promise<string> {
  if (!provider) throw new Error('Connect Codex to update the description')
  const root = join(store.root, 'summaries')
  await inspectDomainRecords(store.db.prepare('SELECT * FROM summary_domains').all(), root, runtime.helper)
  store.db.prepare('DELETE FROM summary_domains').run()
  const deadline = AbortSignal.timeout(60000); const activeSignal = AbortSignal.any([signal, deadline])
  let finish!: () => void; const completed = new Promise<void>((resolve) => { finish = resolve })
  let failure: Error | null = null; let output = ''; let threadId = ''; let turnId = ''
  const fail = (message: string) => { failure = new Error(message); finish() }
  const abort = () => fail('Description generation was interrupted or timed out')
  activeSignal.addEventListener('abort', abort, { once: true })
  let transport: MasterTransport | null = null
  try {
    activeSignal.throwIfAborted()
    transport = await MasterTransport.start(runtime, root, { provider, tool: async () => { throw new Error('Description generation has no tools') } }, (path, pid) => { store.db.prepare('INSERT INTO summary_domains VALUES(?,?)').run(path, pid) }, (frame) => {
      if (frame.id !== undefined) { fail('Description generation attempted a tool call'); return }
      if (frame.method === 'transport/failed') { fail('Description model connection failed'); return }
      const params = frame.params ?? {}
      if (params.threadId !== threadId) return
      const turn = params.turn as { id?: string, status?: string } | undefined
      if (frame.method === 'turn/started' && turn?.id) { turnId = turn.id; return }
      if (frame.method === 'turn/completed' && turn?.id === turnId) { if (turn?.status !== 'completed') fail('Description model turn did not complete'); else finish(); return }
      if (params.turnId !== turnId) return
      const item = params.item as { type?: string, text?: string } | undefined
      if (frame.method === 'item/completed' && item?.type === 'agentMessage' && typeof item.text === 'string') {
        if (item.text.length > 16000) { fail('Description model output exceeds its limit'); return }
        output = item.text
      }
    })
    threadId = await transport.thread(runtime, root, null, true)
    activeSignal.throwIfAborted()
    await transport.request('turn/start', { threadId, input: [{ type: 'text', text: input }], outputSchema: { type: 'object', properties: { description: { type: 'string' } }, required: ['description'], additionalProperties: false } })
    await completed
    activeSignal.throwIfAborted()
    if (failure) throw failure
    const parsed: unknown = JSON.parse(output)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length !== 1 || !('description' in parsed) || typeof parsed.description !== 'string') throw new Error('Description model returned an invalid result')
    return parsed.description
  }
  finally { activeSignal.removeEventListener('abort', abort); await transport?.close() }
}
