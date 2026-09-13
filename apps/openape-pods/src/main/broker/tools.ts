import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { CredentialCache } from '../connections/cache'
import { launchSandbox, verifyExecutable } from '../../worker/runtime/sandbox'
import type { AgentAuthority, AssignedAuthorization } from './authorization'

export interface ToolAssignment extends AssignedAuthorization {
  id: string
  capability: string
  executable: string
  executableHash: string
  entryFiles: { path: string, hash: string }[]
  prefix: string[]
  connectionId?: string
  runtimeDirectories: string[]
  environment: Record<string, string>
  networkPorts: number[]
}
export interface BrokerLease {
  registerDomain?: (path: string, ownerPid: number) => void
  capabilities: string[]
  assertCurrent: () => void
  signal: AbortSignal
}
export interface ToolReply { exitCode: number, stdout: string, stderr: string }
function secretStrings(value: unknown): string[] {
  if (typeof value === 'string') return value.length >= 8 ? [value] : []
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(secretStrings)
}
export class PodToolBroker {
  constructor(private readonly helper: string, private readonly root: string, private readonly authority: AgentAuthority, private readonly credentials: CredentialCache) {}
  async execute(assignment: ToolAssignment, request: unknown, lease: BrokerLease): Promise<ToolReply> {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Invalid ape-shell request')
    const value = request as Record<string, unknown>
    if (Object.keys(value).some(key => !['toolId', 'argv'].includes(key)) || value.toolId !== assignment.id || !Array.isArray(value.argv) || JSON.stringify(value.argv) !== JSON.stringify(assignment.command.argv)) throw new Error('Command is outside the assigned tool call')
    lease.assertCurrent(); lease.signal.throwIfAborted()
    if (!lease.capabilities.includes(assignment.capability)) throw new Error('Script does not declare this capability')
    await verifyExecutable(assignment.executable, assignment.executableHash)
    for (const file of assignment.entryFiles) await verifyExecutable(file.path, file.hash)
    await this.authority.authorize(assignment, lease.signal)
    lease.assertCurrent(); lease.signal.throwIfAborted()
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    if (assignment.connectionId) {
      return this.credentials.withCache(assignment.connectionId, async (cache) => {
        lease.assertCurrent(); lease.signal.throwIfAborted()
        return this.run(assignment, lease, dirname(cache), cache)
      })
    }
    const workspace = await mkdtemp(join(this.root, 'tool-'))
    try { return await this.run(assignment, lease, workspace) }
    finally { await rm(workspace, { recursive: true, force: true }) }
  }

  private async run(assignment: ToolAssignment, lease: BrokerLease, workspace: string, cache?: string): Promise<ToolReply> {
    await this.authority.assertActive(assignment.grantId, lease.signal)
    lease.assertCurrent(); lease.signal.throwIfAborted()
    const secrets = cache ? secretStrings(JSON.parse(await readFile(cache, 'utf8'))) : []
    const domain = await launchSandbox(this.helper, this.root, { executable: assignment.executable, workspace: await realpath(workspace), readFiles: assignment.entryFiles.map(file => file.path), runtimeDirectories: assignment.runtimeDirectories, networkPorts: assignment.networkPorts }, [...assignment.prefix, ...assignment.command.argv.slice(1)], { ...assignment.environment, ...(cache ? { POD_TOOL_AUTH_FILE: cache } : {}) }, lease.registerDomain)
    let stdout = ''; let stderr = ''; let failure: Error | undefined
    const stop = () => { failure ??= new Error('Tool call cancelled'); domain.cancel() }
    lease.signal.addEventListener('abort', stop, { once: true })
    if (lease.signal.aborted) stop()
    const append = (which: 'stdout' | 'stderr', bytes: Buffer) => {
      if (stdout.length + stderr.length + bytes.length > 256 * 1024) { failure = new Error('Tool output exceeded its limit'); domain.cancel(); return }
      if (which === 'stdout') stdout += bytes.toString()
      else stderr += bytes.toString()
    }
    domain.stdout.on('data', bytes => append('stdout', bytes)); domain.stderr.on('data', bytes => append('stderr', bytes))
    const monitoring = new AbortController()
    const poll = async () => {
      try {
        while (!monitoring.signal.aborted) {
          await delay(1000, undefined, { signal: monitoring.signal })
          lease.assertCurrent()
          await this.authority.assertActive(assignment.grantId, AbortSignal.any([lease.signal, monitoring.signal]))
        }
      }
      catch (error) {
        if (monitoring.signal.aborted) return
        failure = error instanceof Error ? error : new Error('Tool authority lost'); domain.cancel()
      }
    }
    const monitor = poll()
    const deadline = setTimeout(() => { failure = new Error('Tool call exceeded its time limit'); domain.cancel() }, 60000)
    try {
      await domain.processId
      const exitCode = await domain.completed
      if (failure) throw failure
      await this.authority.assertActive(assignment.grantId, lease.signal)
      lease.assertCurrent(); lease.signal.throwIfAborted()
      if (cache) secrets.push(...secretStrings(JSON.parse(await readFile(cache, 'utf8'))))
      for (const secret of secrets) { stdout = stdout.replaceAll(secret, '[REDACTED]'); stderr = stderr.replaceAll(secret, '[REDACTED]') }
      return { exitCode, stdout, stderr }
    }
    finally {
      clearTimeout(deadline); monitoring.abort(); lease.signal.removeEventListener('abort', stop)
      domain.cancel(); await domain.completed; await monitor
    }
  }
}
