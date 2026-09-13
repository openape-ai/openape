import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseFrame, parseResult } from '../../contracts/runs'
import type { RunInput, ScriptResult } from '../../contracts/runs'
import { launchSandbox } from '../runtime/sandbox'
import type { RuntimePolicy } from '../runtime/sandbox'

export interface ScriptRuntime { helper: string, executable: string, entry: string, runtimeDirectories: string[], environment: Record<string, string> }
export interface ScriptServices { request: (operation: string, payload: unknown, signal: AbortSignal) => Promise<unknown>, event: (type: string, data: unknown) => void }
async function interruptible<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let stop: () => void = () => {}
  const cancelled = new Promise<never>((_resolve, reject) => { stop = () => reject(signal.reason); signal.addEventListener('abort', stop, { once: true }) })
  try { return await Promise.race([operation(), cancelled]) }
  finally { signal.removeEventListener('abort', stop) }
}
export async function executeScript(runtime: ScriptRuntime, directory: string, artifact: string, input: RunInput, signal: AbortSignal, services: ScriptServices): Promise<ScriptResult> {
  await mkdir(directory, { recursive: true, mode: 0o700 }); await mkdir(input.workspace, { recursive: true, mode: 0o700 })
  const config = join(directory, 'input.json')
  await writeFile(config, JSON.stringify({ entry: artifact, input }), { flag: 'wx', mode: 0o400 })
  await readFile(artifact)
  const policy: RuntimePolicy = { executable: runtime.executable, workspace: input.workspace, readFiles: [artifact, runtime.entry, config, ...input.references.map(reference => reference.path)], runtimeDirectories: runtime.runtimeDirectories }
  const domain = await launchSandbox(runtime.helper, directory, policy, [runtime.entry, config], runtime.environment)
  const local = new AbortController()
  const activeSignal = AbortSignal.any([signal, local.signal])
  let requesting = false
  domain.channel.setEncoding('utf8'); domain.stdout.setEncoding('utf8'); domain.stderr.setEncoding('utf8')
  const stop = () => domain.cancel()
  signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop()
  const timeout = setTimeout(() => { local.abort(new Error('Script exceeded its time limit')); stop() }, input.limits.timeMs)
  let terminal: ScriptResult | undefined; let failure: Error | undefined; let sequence = 0; let logBytes = 0
  const log = (bytes: Buffer) => {
    logBytes += bytes.length
    if (logBytes > 256 * 1024) { failure = new Error('Script diagnostic output exceeded its limit'); stop(); return }
    services.event('diagnostic', { text: bytes.toString() })
  }
  domain.stdout.on('data', log); domain.stderr.on('data', log)
  const consume = async () => {
    let buffer = ''
    for await (const bytes of domain.channel) {
      buffer += String(bytes)
      if (!buffer.includes('\n') && Buffer.byteLength(buffer) > input.limits.frameBytes) throw new Error('Script frame exceeds its size limit')
      for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
        const text = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        if (Buffer.byteLength(text) > input.limits.frameBytes) throw new Error('Script frame exceeds its size limit')
        const frame = parseFrame(JSON.parse(text), input.runId, ++sequence)
        if (terminal) throw new Error('Script emitted data after its terminal result')
        activeSignal.throwIfAborted()
        if (frame.type === 'result') terminal = parseResult(frame.payload, input)
        if (frame.type === 'error') throw new Error(`Script failed: ${JSON.stringify(frame.payload).slice(0, 4000)}`)
        if (frame.type === 'log') services.event('log', frame.payload)
        if (frame.type === 'request') {
          try {
            requesting = true
            const value = await interruptible(() => services.request(frame.operation!, frame.payload, activeSignal), activeSignal)
            const reply = JSON.stringify({ version: 1, runId: input.runId, id: frame.id, ok: true, value })
            if (Buffer.byteLength(reply) > input.limits.frameBytes) throw new Error('Runner response exceeds its size limit')
            domain.channel.write(`${reply}\n`)
          }
          catch (error) { activeSignal.throwIfAborted(); domain.channel.write(`${JSON.stringify({ version: 1, runId: input.runId, id: frame.id, ok: false, error: error instanceof Error ? error.message : 'Operation failed' })}\n`) }
          finally { requesting = false }
        }
      }
    }
    if (buffer.length) throw new Error('Truncated script frame')
  }
  const frames = (async () => {
    try { await consume() }
    catch (error) { failure = error instanceof Error ? error : new Error('Invalid script protocol'); stop() }
  })()
  try {
    const pid = await domain.processId; services.event('process', { pid })
    const code = await domain.completed
    if (requesting) local.abort(new Error('Script exited during a pending operation'))
    await frames
    activeSignal.throwIfAborted()
    if (failure) throw failure
    if (code !== 0) throw new Error(`Script exited with code ${code}`)
    if (!terminal) throw new Error('Script exited without a terminal result')
    return terminal
  }
  finally { local.abort(new Error('Script runtime closed')); clearTimeout(timeout); signal.removeEventListener('abort', stop); stop(); await domain.completed; await frames }
}
