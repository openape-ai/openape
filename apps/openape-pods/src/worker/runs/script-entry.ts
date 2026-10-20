import { ResponseOutput, scriptFrameBytes } from './response.ts'
import { createRequire, isBuiltin, registerHooks } from 'node:module'
import { join } from 'node:path'
import { Socket } from 'node:net'
import { pathToFileURL } from 'node:url'
import type { RunInput } from '../../contracts/runs'
import { freeze, scriptContext } from './script-context.ts'
import type { ScriptModule } from './script-context.ts'

async function channelInput(channel: Socket): Promise<RunInput> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    let timer: ReturnType<typeof setTimeout>
    function finish(error?: Error, input?: RunInput): void {
      clearTimeout(timer); channel.removeListener('data', data); channel.removeListener('error', failed); channel.removeListener('end', ended)
      if (error) reject(error); else resolve(input!)
    }
    function failed(error: Error): void { finish(error) }
    function ended(): void { finish(new Error('Script input channel closed before its input')) }
    function data(bytes: Buffer | string): void {
      buffer += String(bytes)
      if (Buffer.byteLength(buffer) > scriptFrameBytes) { finish(new Error('Script input exceeds its size bound')); return }
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      try {
        if (newline !== buffer.length - 1) throw new Error('Unexpected data after initial script input')
        const input = JSON.parse(buffer.slice(0, newline)) as RunInput
        if (input.version !== 1 || typeof input.runId !== 'string' || input.scriptHash !== process.argv[5]) throw new Error('Script input does not match the authorized script')
        finish(undefined, input)
      }
      catch (error) { finish(error instanceof Error ? error : new Error('Invalid script input')) }
    }
    timer = setTimeout(() => finish(new Error('Script input channel timed out')), 30000)
    channel.on('data', data); channel.once('error', failed); channel.once('end', ended)
  })
}

async function main(): Promise<void> {
  const channel = new Socket({ fd: 3, readable: true, writable: true })
  channel.setEncoding('utf8')
  if (process.argv[2] !== '--input-channel') throw new Error('Script execution requires its private input channel')
  const config = { input: await channelInput(channel), entry: process.argv[3], dependencyRoot: process.argv[4] || undefined }
  const pending = new Map<string, { resolve: (value: unknown) => void, reject: (error: Error) => void, output: ResponseOutput }>()
  const controller = new AbortController()
  let sequence = 0; let buffer = ''
  function send(type: string, payload: unknown, extra: Record<string, unknown> = {}): void {
    const frame = JSON.stringify({ version: 1, runId: config.input.runId, sequence: sequence + 1, type, payload, ...extra })
    if (Buffer.byteLength(frame) > config.input.limits.frameBytes) throw new Error('Script frame exceeds its size limit')
    sequence++
    channel.write(`${frame}\n`)
  }
  function request(operation: string, payload: unknown): Promise<unknown> {
    const id = `request-${sequence + 1}`
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, output: new ResponseOutput() })
      try { send('request', payload, { id, operation }) }
      catch (error) { pending.delete(id); reject(error instanceof Error ? error : new Error('Invalid request')) }
    })
  }
  channel.on('data', (bytes: Buffer) => {
    try {
      buffer += bytes.toString()
      if (!buffer.includes('\n') && Buffer.byteLength(buffer) > config.input.limits.frameBytes) throw new Error('Oversized runner response')
      for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
        if (Buffer.byteLength(buffer.slice(0, newline)) > config.input.limits.frameBytes) throw new Error('Oversized runner response')
        const frame = JSON.parse(buffer.slice(0, newline)) as { version?: number, runId?: string, id?: string, ok?: boolean, value?: unknown, error?: string, outputPart?: unknown, text?: unknown, stream?: unknown, outputParts?: unknown }
        buffer = buffer.slice(newline + 1)
        if (frame.version !== 1 || frame.runId !== config.input.runId || !frame.id || !pending.has(frame.id) || typeof frame.ok !== 'boolean') throw new Error('Invalid runner reply')
        const operation = pending.get(frame.id)!
        if (frame.outputPart !== undefined) {
          if (!frame.ok || frame.value !== undefined || frame.outputParts !== undefined) throw new Error('Invalid program output chunk')
          operation.output.append(frame.outputPart, frame.stream, frame.text); continue
        }
        const value = frame.ok ? operation.output.finish(frame.value, frame.outputParts) : undefined
        pending.delete(frame.id)
        if (frame.ok) operation.resolve(value)
        else operation.reject(new Error(frame.error ?? 'Pod operation failed'))
      }
    }
    catch (error) { controller.abort(error); channel.destroy(error instanceof Error ? error : new Error('Protocol failed')) }
  })
  channel.on('error', (error) => { controller.abort(error); for (const operation of pending.values()) operation.reject(error); pending.clear(); process.exitCode = 1 })
  channel.on('end', () => { if (pending.size) channel.destroy(new Error('Runner channel closed during a pending response')) })
  if (config.dependencyRoot) {
    const entry = pathToFileURL(config.entry).href
    const parentURL = pathToFileURL(join(config.dependencyRoot, 'entry.mjs')).href
    registerHooks({
      resolve(specifier, context, nextResolve) {
        const bare = !isBuiltin(specifier) && !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.includes(':') && !specifier.startsWith('#')
        if (context.parentURL !== entry || !bare) return nextResolve(specifier, context)
        if (context.conditions.includes('require')) return nextResolve(createRequire(parentURL).resolve(specifier), context)
        return nextResolve(specifier, { ...context, parentURL })
      },
    })
  }
  const input = freeze(config.input)
  try {
    const script = await import(pathToFileURL(config.entry).href) as ScriptModule
    if (typeof script.run !== 'function') throw new Error('Script must export run(context)')
    const result = await script.run(await scriptContext(script, input, request, message => send('log', { message }), controller.signal))
    if (pending.size) throw new Error('Script returned with unfinished operations')
    send('result', result)
  }
  catch (error) { send('error', { message: error instanceof Error ? error.message : 'Script failed' }); process.exitCode = 1 }
  finally { channel.end(() => channel.destroy()) }
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Script runtime failed'); process.exitCode = 1 })
