import { codexNetworkRead, parseCodexNetworkAction } from '../../contracts/codex-networks'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMcpAccess, parseMcpAccessCommand } from '../../contracts/mcp-access'
import type { McpAccess, McpDuration, McpMode } from '../../contracts/mcp-access'
import type { CodexRequest } from '../../contracts/codex'

export class McpAccessPolicy {
  private state: McpAccess = { mode: 'off', duration: 'hour', expiresAt: null }
  private readonly path: string
  constructor(private readonly root: string, private readonly now: () => number = Date.now) {
    this.path = join(root, 'mcp-access.json')
    try { this.state = parseMcpAccess(JSON.parse(readFileSync(this.path, 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }

  get(): McpAccess {
    if (this.state.expiresAt !== null && this.now() >= this.state.expiresAt) this.save({ ...this.state, mode: 'off', expiresAt: null })
    return { ...this.state }
  }

  set(mode: McpMode, duration: McpDuration): McpAccess {
    parseMcpAccessCommand({ type: 'set', mode, duration })
    const previous = this.get()
    const preserveDeadline = previous.mode !== 'off' && previous.duration === duration
    const expiresAt = mode === 'off' || duration === 'permanent' ? null : preserveDeadline ? previous.expiresAt : this.now() + (duration === 'hour' ? 3600000 : 86400000)
    this.save({ mode, duration, expiresAt })
    return this.get()
  }

  assert(request: CodexRequest): void {
    const { mode } = this.get()
    if (mode === 'off') throw new Error('MCP access is off. Enable it in App settings.')
    if (mode === 'read' && !readOnlyAction(request.action)) throw new Error('MCP is read-only. Enable write access in App settings to make changes or start runs.')
  }

  private save(state: McpAccess): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    writeFileSync(`${this.path}.tmp`, JSON.stringify(state), { mode: 0o600, flush: true })
    renameSync(`${this.path}.tmp`, this.path)
    this.state = state
  }
}

export function readOnlyAction(action: Record<string, unknown>): boolean {
  if (typeof action.action !== 'string') return false
  if (action.action === 'networks') return codexNetworkRead(parseCodexNetworkAction(action))
  if (['runtime', 'list', 'inspect', 'changes', 'select'].includes(action.action)) return true
  const query = action.query as Record<string, unknown> | undefined
  if (action.action === 'workspace') return !!query && typeof query.type === 'string' && ['inventory', 'read', 'operation'].includes(query.type)
  const command = action.command as Record<string, unknown> | undefined
  return ['resources', 'scripts', 'description', 'recovery', 'program'].includes(action.action) && command?.type === 'list'
}
