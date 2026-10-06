import { mkdir, writeFile } from 'node:fs/promises'
import { registerAuthDomain, recoverAuthDomains } from './ledger'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { superviseProcess } from '../../worker/runtime/sandbox'
import type { ProcessDomain } from '../../worker/runtime/sandbox'
import type { AgentRuntime } from '../../worker/agent/executor'

export interface AuthFrame { id?: number | string, method?: string, params?: Record<string, unknown>, result?: unknown, error?: unknown, event?: string, [key: string]: unknown }
export class AuthProcess {
  private sequence = 0
  private pending = new Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }>()
  private reading: Promise<void>
  private constructor(private readonly domain: ProcessDomain, private readonly signal: AbortSignal, private readonly notify: (frame: AuthFrame) => void) {
    domain.stderr.resume(); domain.stdout.resume(); domain.channel.setEncoding('utf8')
    this.reading = this.read().catch((error: unknown) => { this.fail(error instanceof Error ? error : new Error('Invalid authentication response')); domain.cancel() })
    signal.addEventListener('abort', this.stop, { once: true }); if (signal.aborted) this.stop()
    void this.watch()
  }

  static async start(runtime: AgentRuntime, root: string, executable: string, args: string[], cwd: string, environment: Record<string, string>, signal: AbortSignal, notify: (frame: AuthFrame) => void): Promise<AuthProcess> {
    const launch = join(root, randomUUID()); await mkdir(launch, { recursive: true, mode: 0o700 })
    const config = join(launch, 'auth-host.json'); await writeFile(config, JSON.stringify({ executable, args, cwd, environment }), { flag: 'wx', mode: 0o600 })
    const register = (path: string, ownerPid: number) => registerAuthDomain(root, path, ownerPid)
    const domain = await superviseProcess(runtime.helper, runtime.executable, [join(dirname(runtime.sdkHost), 'auth-host.mjs'), config], cwd, runtime.environment, launch, register)
    const process = new AuthProcess(domain, signal, notify)
    try { await domain.processId; return process }
    catch (error) { await process.close(); throw error }
  }

  static async recover(root: string, helper: string): Promise<void> { await recoverAuthDomains(root, helper) }

  request(method: string, params: unknown): Promise<unknown> {
    if (!['initialize', 'account/login/start', 'account/login/cancel', 'account/read'].includes(method)) return Promise.reject(new Error('Authentication process cannot execute model or tool requests'))
    this.signal.throwIfAborted(); const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Authentication service timed out')); this.stop() }, 30000)
      this.pending.set(id, { resolve, reject, timer }); this.domain.channel.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  initialized(): void { this.domain.channel.write('{"method":"initialized"}\n') }
  private async read(): Promise<void> {
    let buffer = ''
    for await (const bytes of this.domain.channel) {
      buffer += String(bytes)
      if (Buffer.byteLength(buffer) > 1024 * 1024) throw new Error('Authentication response is too large')
      for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
        const value: unknown = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1)
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid authentication frame')
        const frame = value as AuthFrame
        if (frame.method && frame.id !== undefined) { this.domain.channel.write(`${JSON.stringify({ id: frame.id, error: { code: -32601, message: 'Authentication only' } })}\n`); continue }
        const pending = typeof frame.id === 'number' && !frame.method ? this.pending.get(frame.id) : undefined
        if (pending && typeof frame.id === 'number') {
          this.pending.delete(frame.id); clearTimeout(pending.timer)
          if (frame.error) pending.reject(new Error('Authentication service rejected the request')); else pending.resolve(frame.result)
        }
        else {
          this.notify(frame)
        }
      }
    }
    if (buffer) throw new Error('Truncated authentication response')
  }

  private async watch(): Promise<void> {
    try { const code = await this.domain.completed; this.fail(new Error(`Authentication process stopped (${code})`)) }
    catch (error) { this.fail(error instanceof Error ? error : new Error('Authentication process failed')) }
  }

  private fail(error: Error): void { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }; this.pending.clear(); this.notify({ event: 'processStopped', message: error.message }) }
  private stop = () => this.domain.cancel()
  async close(): Promise<void> { this.signal.removeEventListener('abort', this.stop); this.stop(); await this.domain.completed; await this.reading }
}
