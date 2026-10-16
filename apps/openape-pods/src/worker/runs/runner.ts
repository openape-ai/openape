import { NonRetryableError } from '../../contracts/infrastructure'
import type { PreparedMachine, PreparationPurpose } from '../runtime/execution-identity'
import { launchApeShell } from '../runtime/ape-shell'
import type { MachineLaunch } from '../runtime/ape-shell'
import { observeExecution } from '../../main/programs/execution'
import type { ExecutionObserver } from '../../main/programs/execution'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, realpath, lstat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { parseFrame, parseResult } from '../../contracts/runs'
import type { RunInput, ScriptResult } from '../../contracts/runs'
import type { SandboxReach } from '../../contracts/sandbox'
import type { RuntimePolicy } from '../runtime/sandbox'
import { programInvocation } from '../../runtime/program-invocation'
import type { ProgramCall } from '../../main/broker/authorization'

export interface ScriptRuntime { reach?: SandboxReach, prepareExecution?: (podId: string, purpose: PreparationPurpose, signal: AbortSignal) => Promise<{ machine: PreparedMachine, close: () => Promise<void> }>, machine?: Omit<MachineLaunch, 'operationId' | 'executableHash' | 'files'> & { issuer?: string }, dependencyRoot?: string, home?: string, registerDomain?: (path: string, ownerPid: number) => void | Promise<void>, helper: string, executable: string, entry: string, runtimeDirectories: string[], environment: Record<string, string> }
export interface ScriptServices { prepareStart?: (call: ProgramCall) => Promise<void>, execution?: ExecutionObserver, budgetPaused?: () => boolean,  request: (operation: string, payload: unknown, signal: AbortSignal) => Promise<unknown>, event: (type: string, data: unknown) => void }
async function interruptible<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let stop: () => void = () => {}
  const cancelled = new Promise<never>((_resolve, reject) => { stop = () => reject(signal.reason); signal.addEventListener('abort', stop, { once: true }) })
  try { return await Promise.race([operation(), cancelled]) }
  finally { signal.removeEventListener('abort', stop) }
}
export async function executeScript(runtime: ScriptRuntime, directory: string, artifact: string, input: RunInput, signal: AbortSignal, services: ScriptServices): Promise<ScriptResult> {
  await mkdir(directory, { recursive: true, mode: 0o700 }); await mkdir(input.workspace, { recursive: true, mode: 0o700 })
  if (!runtime.machine) throw new Error('Script execution requires ape-shell and its assigned identity')
  if (createHash('sha256').update(await readFile(artifact)).digest('hex') !== input.scriptHash) throw new Error('Script artifact does not match the selected source')
  if (runtime.machine) {
    const scripts = join(await realpath(dirname(directory)), 'script-artifacts'); await mkdir(scripts, { recursive: true, mode: 0o700 })
    const stable = join(scripts, `${input.scriptHash}.mjs`)
    try { await writeFile(stable, await readFile(artifact), { flag: 'wx', mode: 0o400 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    if (!(await lstat(stable)).isFile() || await realpath(stable) !== stable || createHash('sha256').update(await readFile(stable)).digest('hex') !== input.scriptHash) throw new Error('Immutable script artifact changed')
    artifact = stable
  }
  const home = runtime.home ?? input.home ?? input.workspace
  const policy: RuntimePolicy = { ...(runtime.reach ? { reach: runtime.reach } : {}), executable: runtime.executable, workspace: input.workspace, readFiles: [artifact, runtime.entry, ...input.references.map(reference => reference.path)], runtimeDirectories: runtime.runtimeDirectories, readDirectories: [...(runtime.dependencyRoot ? [runtime.dependencyRoot] : []), ...(input.directories ?? []).filter(item => item.access === 'read').map(item => item.path)], writeDirectories: [...(runtime.reach?.level === 'owner' ? [] : [home]), ...(input.directories ?? []).filter(item => item.access === 'readWrite').map(item => item.path)] }
  if (runtime.reach?.level === 'owner') {
    const parents = new Set<string>()
    for (const file of policy.readFiles) {
      let parent = dirname(file)
      for (;;) { parents.add(parent); const next = dirname(parent); if (next === parent) break; parent = next }
    }
    policy.metadataPaths = [...parents]
  }
  if (runtime.machine && !services.execution) throw new Error('Script execution requires its durable lifecycle observer')
  const environment = { ...runtime.environment, HOME: home, TMPDIR: runtime.environment.TMPDIR ?? home }
  const argv = [runtime.entry, '--input-channel', artifact, runtime.dependencyRoot ?? '', input.scriptHash]
  const executableHash = createHash('sha256').update(await readFile(runtime.executable)).digest('hex')
  const files = [{ path: runtime.entry, sha256: createHash('sha256').update(await readFile(runtime.entry)).digest('hex') }, { path: artifact, sha256: input.scriptHash }]
  if (services.prepareStart) await services.prepareStart(await programInvocation(runtime.executable, executableHash, argv, files, input.workspace, environment))
  signal.throwIfAborted()
  const domain = await launchApeShell(runtime.helper, directory, policy, argv, environment, {
    ...runtime.machine,
    operationId: input.runId,
    forwardChannel: true,
    executableHash,
    files,
  }, runtime.registerDomain)
  if (runtime.machine) {
    const frame = `${JSON.stringify(input)}\n`
    if (Buffer.byteLength(frame) > 256 * 1024) { domain.cancel(); await domain.completed; throw new Error('Script input exceeds its size bound') }
    domain.channel.write(frame)
  }
  const local = new AbortController()
  const activeSignal = AbortSignal.any([signal, local.signal])
  let requesting = false
  domain.channel.setEncoding('utf8'); domain.stdout.setEncoding('utf8'); domain.stderr.setEncoding('utf8')
  const stop = () => domain.cancel()
  signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop()
  let executing = false
  let remaining = input.limits.timeMs; let checkedAt = Date.now()
  const timeout = setInterval(() => {
    const now = Date.now()
    if (executing && !services.budgetPaused?.()) remaining -= now - checkedAt
    checkedAt = now
    if (remaining <= 0) { local.abort(new Error('Script exceeded its time limit')); stop() }
  }, 250)
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
        if (frame.type === 'error') {
          const message = frame.payload && typeof frame.payload === 'object' && 'message' in frame.payload && typeof frame.payload.message === 'string' ? frame.payload.message : 'Script failed without an error message'
          throw new Error(message.slice(0, 4000))
        }
        if (frame.type === 'log') services.event('log', frame.payload)
        if (frame.type === 'request') {
          try {
            requesting = true
            services.event('operation', { id: frame.id, operation: frame.operation, state: 'started' })
            const value = await interruptible(() => services.request(frame.operation!, frame.payload, activeSignal), activeSignal)
            services.event('operation', { id: frame.id, operation: frame.operation, state: 'completed' })
            const reply = JSON.stringify({ version: 1, runId: input.runId, id: frame.id, ok: true, value })
            if (Buffer.byteLength(reply) > input.limits.frameBytes) throw new Error('Runner response exceeds its size limit')
            domain.channel.write(`${reply}\n`)
          }
          catch (error) { services.event('operation', { id: frame.id, operation: frame.operation, state: 'failed' }); activeSignal.throwIfAborted(); domain.channel.write(`${JSON.stringify({ version: 1, runId: input.runId, id: frame.id, ok: false, error: error instanceof Error ? error.message : 'Operation failed' })}\n`) }
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
    const observed = await observeExecution(domain, input.runId, { ...services.execution!, starting: () => { checkedAt = Date.now(); executing = true; services.execution!.starting?.() } }, activeSignal).catch((error: unknown) => {
      // Keep the script diagnostic without treating a missing execution receipt as safe to replay.
      if (failure) throw new NonRetryableError(`${failure.message}; ${error instanceof Error ? error.message : 'Execution receipt is unavailable'}`)
      throw error
    })
    if (observed?.kind === 'pending') throw new Error('Script execution approval is pending')
    const code = observed?.exitCode ?? await domain.completed
    if (requesting) local.abort(new Error('Script exited during a pending operation'))
    await frames
    activeSignal.throwIfAborted()
    if (failure) throw failure
    if (code !== 0) throw new Error(`Script exited with code ${code}`)
    if (!terminal) throw new Error('Script exited without a terminal result')
    return terminal
  }
  finally { local.abort(new Error('Script runtime closed')); clearInterval(timeout); signal.removeEventListener('abort', stop); stop(); await domain.completed; await frames }
}
