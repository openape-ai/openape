import { readFile } from 'node:fs/promises'
import { Socket } from 'node:net'
import { pathToFileURL } from 'node:url'
import type { RunInput } from '../../contracts/runs'

async function main(): Promise<void> {
  const config = JSON.parse(await readFile(process.argv[2], 'utf8')) as { input: RunInput, entry: string }
  const channel = new Socket({ fd: 3, readable: true, writable: true })
  channel.setEncoding('utf8')
  const pending = new Map<string, { resolve: (value: unknown) => void, reject: (error: Error) => void }>()
  const controller = new AbortController()
  let sequence = 0; let buffer = ''
  function freeze<T>(value: T): T {
    if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value) }
    return value
  }
  function send(type: string, payload: unknown, extra: Record<string, unknown> = {}): void {
    const frame = JSON.stringify({ version: 1, runId: config.input.runId, sequence: ++sequence, type, payload, ...extra })
    if (Buffer.byteLength(frame) > config.input.limits.frameBytes) throw new Error('Script frame exceeds its size limit')
    channel.write(`${frame}\n`)
  }
  function request(operation: string, payload: unknown): Promise<unknown> {
    const id = `request-${sequence + 1}`
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); send('request', payload, { id, operation }) })
  }
  channel.on('data', (bytes: Buffer) => {
    try {
      buffer += bytes.toString()
      if (!buffer.includes('\n') && Buffer.byteLength(buffer) > config.input.limits.frameBytes) throw new Error('Oversized runner response')
      for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
        if (Buffer.byteLength(buffer.slice(0, newline)) > config.input.limits.frameBytes) throw new Error('Oversized runner response')
        const frame = JSON.parse(buffer.slice(0, newline)) as { version?: number, runId?: string, id?: string, ok?: boolean, value?: unknown, error?: string }
        buffer = buffer.slice(newline + 1)
        if (frame.version !== 1 || frame.runId !== config.input.runId || !frame.id || !pending.has(frame.id) || typeof frame.ok !== 'boolean') throw new Error('Invalid runner reply')
        const operation = pending.get(frame.id)!; pending.delete(frame.id)
        if (frame.ok) operation.resolve(frame.value)
        else operation.reject(new Error(frame.error ?? 'Pod operation failed'))
      }
    }
    catch (error) { controller.abort(error); channel.destroy(error instanceof Error ? error : new Error('Protocol failed')) }
  })
  channel.on('error', (error) => { controller.abort(error); for (const operation of pending.values()) operation.reject(error); pending.clear(); process.exitCode = 1 })
  const input = freeze(config.input)
  try {
    const script = await import(pathToFileURL(config.entry).href) as { run?: (context: unknown) => Promise<unknown> }
    if (typeof script.run !== 'function') throw new Error('Script must export run(context)')
    const result = await script.run(Object.freeze({ input, workspace: input.workspace, references: input.references, signal: controller.signal, tools: Object.freeze({ invoke: (payload: unknown) => request('tools.invoke', payload) }), agent: Object.freeze({ run: (payload: unknown) => request('agent.run', payload) }), progress: Object.freeze({ commit: (payload: unknown) => request('progress.commit', payload) }), log: (message: string) => send('log', { message }) }))
    if (pending.size) throw new Error('Script returned with unfinished operations')
    send('result', result)
  }
  catch (error) { send('error', { message: error instanceof Error ? error.message : 'Script failed' }); process.exitCode = 1 }
  finally { channel.end(() => channel.destroy()) }
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Script runtime failed'); process.exitCode = 1 })
