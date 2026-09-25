import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { centralId, centralObject, parseCentralCommand } from '../../contracts/central'
import type { CentralCommand } from '../../contracts/central'
import { parseRuntimeApprovalPreference } from '../../contracts/runtime-approval'

interface LocalCreation { runtimeId: string, command: CentralCommand }
interface State { enabled: boolean, pods: string[], creations: Record<string, LocalCreation> }

export class RuntimeApprovalPolicy {
  private state: State = { enabled: false, pods: [], creations: {} }
  private readonly path: string
  constructor(private readonly root: string) {
    this.path = join(root, 'mcp-runtime-approval.json')
    try {
      const value = centralObject(JSON.parse(readFileSync(this.path, 'utf8')))
      if (Object.keys(value).some(key => !['enabled', 'pods', 'creations'].includes(key)) || !Array.isArray(value.pods)) throw new Error('Invalid local MCP approval state')
      const creations = Object.fromEntries(Object.entries(centralObject(value.creations)).map(([id, item]) => {
        const creation = centralObject(item)
        return [centralId(id), { runtimeId: centralId(creation.runtimeId), command: parseCentralCommand(creation.command) }]
      }))
      this.state = { ...parseRuntimeApprovalPreference({ enabled: value.enabled }), pods: value.pods.map(centralId), creations }
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }

  get enabled(): boolean { return this.state.enabled }
  setEnabled(enabled: boolean): void { this.save({ ...this.state, ...parseRuntimeApprovalPreference({ enabled }) }) }
  allows(podId: string): boolean { return this.state.enabled && this.state.pods.includes(podId) }
  recordPod(podId: string): void {
    centralId(podId)
    if (!this.state.pods.includes(podId)) this.save({ ...this.state, pods: [...this.state.pods, podId] })
  }

  recordCreation(id: string, runtimeId: string, command: CentralCommand): void {
    centralId(id); centralId(runtimeId)
    const parsed = parseCentralCommand(command)
    if (parsed.channel !== 'workspace' || parsed.body.type !== 'create') throw new Error('Expected a local MCP Pod creation')
    const creation = { runtimeId, command: parsed }
    const existing = this.state.creations[id]
    if (existing && JSON.stringify(existing) !== JSON.stringify(creation)) throw new Error('MCP creation identity was reused with different arguments')
    this.save({ ...this.state, creations: { ...this.state.creations, [id]: creation } })
  }

  createdLocally(id: string | undefined, runtimeId: string | null, command: CentralCommand): boolean {
    const creation = id ? this.state.creations[id] : undefined
    return !!creation && creation.runtimeId === runtimeId && JSON.stringify(creation.command) === JSON.stringify(command)
  }

  private save(state: State): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    writeFileSync(`${this.path}.tmp`, JSON.stringify(state), { mode: 0o600, flush: true })
    renameSync(`${this.path}.tmp`, this.path)
    this.state = state
  }
}
