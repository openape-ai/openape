import { spawn } from 'node:child_process'
import { Socket } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { loadAuth } from '../config.js'
import { apiFetch, getGrantsEndpoint } from '../http.js'
import { assertAuthorizedFile } from './execute.js'
import { assertProgramFiles } from './program-files.js'
import { authorizeProgramCall, locateProgram } from './program.js'
import type { ProgramCall, ProgramTokenClaims } from './program.js'
import type { OpenApeExecutionAuthority } from '@openape/core'
import { parseMachineRequest } from './machine-request.js'
import type { MachineRequest } from './machine-request.js'
import { executionFailure } from './machine-failure.js'

/** FD 6 belongs to ape-shell alone; the target receives only its standard streams and, optionally, FD 3. */
export class MachineChannel {
  private socket = new Socket({ fd: 6, readable: true, writable: true })
  private controller = new AbortController()
  private reply = ''
  private maximum = 1024 * 1024
  private receive?: (value: string) => void
  readonly signal = this.controller.signal

  constructor() {
    this.socket.on('error', error => this.controller.abort(error))
    this.socket.on('close', () => this.controller.abort(new Error('Execution controller disconnected')))
    this.socket.setEncoding('utf8')
    this.socket.on('data', (data: string) => {
      this.reply += data
      if (Buffer.byteLength(this.reply) > this.maximum) { this.controller.abort(new Error('Execution controller frame exceeds its bound')); return }
      if (this.reply.includes('\n')) this.receive?.(this.reply)
    })
  }

  async emit(operationId: string | null, state: string, data: Record<string, unknown> = {}): Promise<void> {
    this.signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => this.socket.write(`${JSON.stringify({ version: 1, operationId, state, ...data })}\n`, error => error ? reject(error) : resolve()))
  }

  private async readFrame(): Promise<unknown> {
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(30000)])
    const reply = await new Promise<string>((resolve, reject) => {
      const stop = () => { this.receive = undefined; reject(signal.reason) }
      this.receive = (value) => {
        const newline = value.indexOf('\n')
        this.reply = value.slice(newline + 1)
        signal.removeEventListener('abort', stop); this.receive = undefined; resolve(value.slice(0, newline))
      }
      signal.addEventListener('abort', stop, { once: true })
      if (signal.aborted) stop()
      else if (this.reply.includes('\n')) this.receive(this.reply)
    })
    this.maximum = 8192
    if (Buffer.byteLength(this.reply) > this.maximum) throw new Error('Execution acknowledgement exceeds its bound')
    return JSON.parse(reply)
  }

  async request(mode: 'program' | 'owner-script'): Promise<MachineRequest> { return parseMachineRequest(await this.readFrame(), mode) }

  async executeAcknowledgement(operationId: string): Promise<void> {
    const value = await this.readFrame() as Record<string, unknown> | null
    if (!value || Object.keys(value).sort().join(',') !== 'operationId,state,version' || value.version !== 1 || value.operationId !== operationId || value.state !== 'execute') throw new Error('Invalid execution acknowledgement')
    this.signal.throwIfAborted()
  }

  close(): void { this.socket.destroy() }
}

/** Only the verified IdP resolution can identify a read; unrecognized actions remain writes. */
export function programWrites(claims: ProgramTokenClaims): boolean {
  const details = claims.authorization_details
  return !details?.length || details.some(detail => detail.type !== 'openape_cli' || !['read', 'list', 'get'].includes(detail.action))
}

async function assertActive(grantId: string, signal: AbortSignal): Promise<void> {
  const auth = loadAuth()
  if (!auth) throw new Error('Execution identity is unavailable')
  if (auth.agent_key_id && auth.owner_email) {
    const state = await apiFetch<Record<string, unknown>>(`/api/pods/agents/${encodeURIComponent(auth.email)}?grant=${encodeURIComponent(grantId)}`, { idp: auth.idp, signal })
    if (state.email !== auth.email || state.owner !== auth.owner_email || state.active !== true || state.grantActive !== true || state.grantId !== grantId || !Array.isArray(state.keyIds) || !state.keyIds.includes(auth.agent_key_id)) throw new Error('Execution identity, key or grant is no longer active')
    return
  }
  const endpoint = await getGrantsEndpoint(auth.idp)
  const grant = await apiFetch<{ status: string, expires_at?: number }>(`${endpoint}/${encodeURIComponent(grantId)}`, { idp: auth.idp, signal })
  if (!['approved', 'used'].includes(grant.status) || (grant.expires_at !== undefined && grant.expires_at <= Date.now() / 1000)) throw new Error('Execution grant is no longer active')
}

async function execute(request: MachineRequest, call: ProgramCall, authority: OpenApeExecutionAuthority, channel: MachineChannel, onDispatch: () => void): Promise<number> {
  if (authority.source === 'grant') await assertActive(authority.grantId, AbortSignal.any([channel.signal, AbortSignal.timeout(10000)]))
  channel.signal.throwIfAborted()
  assertAuthorizedFile(call)
  assertProgramFiles([request.sandbox])
  onDispatch()
  await channel.emit(request.operationId, 'starting')
  channel.signal.throwIfAborted()
  assertAuthorizedFile(call)
  assertProgramFiles([request.sandbox])
  const child = spawn('/usr/bin/sandbox-exec', ['-f', request.sandbox.path, call.program.path, ...call.argv], {
    cwd: request.cwd,
    env: request.environment,
    stdio: request.forwardChannel ? ['inherit', 'inherit', 'inherit', 3] : 'inherit',
  })
  const monitor = new AbortController()
  let failure: unknown
  const stop = () => { failure ??= channel.signal.reason; child.kill('SIGKILL') }
  channel.signal.addEventListener('abort', stop, { once: true })
  if (channel.signal.aborted) stop()
  // The native supervisor owns the process group and kills surviving descendants when ape-shell exits.
  const watching = (async () => {
    if (authority.source !== 'grant') return
    try {
      while (!monitor.signal.aborted) {
        await delay(1000, undefined, { signal: monitor.signal })
        await assertActive(authority.grantId, AbortSignal.any([monitor.signal, channel.signal, AbortSignal.timeout(10000)]))
      }
    }
    catch (error) { if (!monitor.signal.aborted) { failure = error; child.kill('SIGKILL') } }
  })()
  try {
    const started = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('spawn', resolve) })
    const completion = new Promise<number>((resolve) => {
      child.once('error', () => resolve(1))
      child.once('exit', code => resolve(code ?? 128))
    })
    await started
    await channel.emit(request.operationId, 'started', { pid: child.pid })
    const exitCode = await completion
    if (failure) throw failure
    await channel.emit(request.operationId, 'completed', { exitCode })
    return exitCode
  }
  finally {
    monitor.abort(); child.kill('SIGKILL'); channel.signal.removeEventListener('abort', stop)
    await watching
  }
}

/** Structured -c mode shares the ordinary program authorizer and never enters the shell-session fallback. */
export async function runMachineRequest(mode: 'program' | 'owner-script' = 'program'): Promise<number> {
  const channel = new MachineChannel()
  let operationId: string | null = null
  let dispatching = false
  try {
    if (process.platform !== 'darwin') throw new Error('Sandboxed machine execution requires macOS')
    const request = await channel.request(mode)
    operationId = request.operationId
    const program = await locateProgram(request.executable.path)
    if (!program || program.sha256 !== request.executable.sha256) throw new Error('Assigned executable changed before authorization')
    const call: ProgramCall = { program, argv: request.argv, files: request.files }
    assertAuthorizedFile(call)
    assertProgramFiles([request.sandbox])
    if ('mode' in request) {
      await channel.emit(operationId, 'authorized', { authority: request.authority, write: false })
      await channel.executeAcknowledgement(operationId)
      return await execute(request, call, request.authority, channel, () => { dispatching = true })
    }
    const auth = loadAuth()
    if (!auth) throw new Error('Machine execution requires an assigned identity')
    const authorization = await authorizeProgramCall(call, {
      idp: auth.idp,
      subject: auth.email,
      targetHost: request.targetHost,
      grantType: request.grantType,
      summary: request.summary,
      batch: request.batch,
      reference: request.reference,
      context: { cwd: request.cwd, env: request.environment },
      wait: request.waitMs > 0,
      waitMs: request.waitMs,
      onPending: pending => channel.emit(operationId, 'pending', pending),
    })
    if (authorization.kind === 'pending') return 75
    const authority: OpenApeExecutionAuthority = { source: 'grant', grantId: authorization.grantId }
    await channel.emit(operationId, 'authorized', { authority, grantId: authorization.grantId, write: programWrites(authorization.claims) })
    await channel.executeAcknowledgement(operationId)
    return await execute(request, call, authority, channel, () => { dispatching = true })
  }
  catch (error) {
    const failure = dispatching ? undefined : executionFailure(error)
    if (!channel.signal.aborted) await channel.emit(operationId, dispatching ? 'unknown' : 'not-started', { error: error instanceof Error ? error.message : 'Machine execution failed', ...(failure ? { failure } : {}) })
    return 1
  }
  finally { channel.close() }
}
