import { randomUUID } from 'node:crypto'
import { basename, join  } from 'node:path'
import { constants } from 'node:fs'
import { open, writeFile } from 'node:fs/promises'
import { loadAdapter, resolveCommand } from '@openape/apes'
import type { ProgramAssignment, ProgramCommand, ProgramDefinition, TerminalView } from '../../contracts/programs'
import type { PodResource, ResourceState } from '../../contracts/resources'
import type { ProgramInternal } from '../../worker/resources/programs'
import type { ConnectionManager } from '../connections/manager'
import type { CredentialCache } from '../connections/cache'
import { verifyExecutable } from '../../worker/runtime/sandbox'
import { ProgramSession } from './session'
import { ProgramState } from './state'

export class ProgramManager {
  private sessions = new Map<string, ProgramSession>()
  constructor(private readonly root: string, private readonly helper: string, private readonly credentials: CredentialCache, private readonly connections: ConnectionManager, private readonly resources: (podId: string) => Promise<ResourceState>, private readonly dispatch: (command: ProgramInternal) => Promise<unknown>) {}
  private async assignment(podId: string, id: string, epoch: number): Promise<ProgramAssignment> {
    const state = await this.resources(podId)
    const resource = state.resources.find(item => item.id === id && item.podId === podId && item.state === 'ready' && item.configuration.type === 'program')
    if (!resource || state.epoch !== epoch) throw new Error('Pod or application permissions changed; reload before assigning access')
    return resource.configuration as unknown as ProgramAssignment
  }

  async add(podId: string, epoch: number, definition: ProgramDefinition): Promise<void> {
    const id = randomUUID()
    const stateId = await new ProgramState(this.credentials).create({ podId, applicationId: id })
    try { await this.dispatch({ type: 'save', podId, id, epoch, configuration: { ...definition, type: 'program', stateId, capability: `tool.app_${id.replaceAll('-', '')}.invoke`, grants: [] } }) }
    catch (error) { await this.credentials.erasePodKey(stateId, podId); throw error }
  }

  async preview(podId: string, id: string, epoch: number, argv: string[]) {
    const assignment = await this.assignment(podId, id, epoch)
    await verifyExecutable(assignment.adapterPath, assignment.adapterHash)
    const adapter = loadAdapter(assignment.cliId, assignment.adapterPath)
    return resolveCommand(adapter, [assignment.cliId, ...argv])
  }

  async grant(command: Extract<ProgramCommand, { type: 'grant' | 'start' }>): Promise<void> {
    const assignment = await this.assignment(command.podId, command.applicationId, command.epoch)
    const resolved = await this.preview(command.podId, command.applicationId, command.epoch, command.argv)
    if (!assignment.grants.some(item => item.permission === resolved.permission) && assignment.grants.length >= 32) throw new Error('This application already has 32 command permissions')
    const authority = await this.connections.approve(command.podId, assignment.adapterPath, [[assignment.cliId, ...command.argv]])
    const grants = [...assignment.grants.filter(item => item.permission !== resolved.permission), { permission: resolved.permission, display: resolved.detail.display, authority }]
    await this.dispatch({ type: 'save', podId: command.podId, id: command.applicationId, epoch: command.epoch, configuration: { ...assignment, grants } })
  }

  async importFile(podId: string, applicationId: string, epoch: number, source: string): Promise<void> {
    const sessionId = randomUUID()
    const resource = await this.dispatch({ type: 'reserve', podId, applicationId, epoch, sessionId }) as PodResource
    const assignment = resource.configuration as unknown as ProgramAssignment
    try {
      const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
      let bytes: Buffer
      try { const stat = await file.stat(); if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error('Choose an application state file up to 4 MB'); bytes = await file.readFile(); if (bytes.length !== stat.size) throw new Error('Application state source changed during import') }
      finally { await file.close() }
      await new ProgramState(this.credentials).use(assignment.stateId, { podId, applicationId }, async (directory) => { await writeFile(join(directory, basename(source)), bytes, { mode: 0o600 }); await this.dispatch({ type: 'check', podId, sessionId }) })
    }
    finally { await this.dispatch({ type: 'release', podId, sessionId }) }
  }

  async terminal(command: Exclude<ProgramCommand, { type: 'add' } | { type: 'importState' }>): Promise<TerminalView> {
    if (command.type === 'grant') throw new Error('Permission approval requires the owner window')
    if (command.type === 'start') {
      for (const [id, session] of this.sessions) {
        if (session.view().state === 'closed') this.sessions.delete(id)
      }
      if (this.sessions.size >= 4) throw new Error('Close another application terminal first')
      const id = randomUUID()
      const resource = await this.dispatch({ type: 'reserve', podId: command.podId, applicationId: command.applicationId, epoch: command.epoch, sessionId: id }) as PodResource
      const check = async () => { await this.dispatch({ type: 'check', podId: command.podId, sessionId: id }) }
      const release = async () => { await this.dispatch({ type: 'release', podId: command.podId, sessionId: id }) }
      const session = new ProgramSession(id, command.podId, command.applicationId, resource.configuration as unknown as ProgramAssignment, command.argv, this.helper, this.root, this.credentials, check, release)
      this.sessions.set(id, session); return session.view()
    }
    const session = this.sessions.get(command.sessionId)
    if (!session || session.podId !== command.podId) throw new Error('Terminal does not belong to this pod or has expired')
    if (command.type === 'input' || command.type === 'resize') await this.dispatch({ type: 'check', podId: command.podId, sessionId: command.sessionId })
    if (command.type === 'input') session.input(command.data)
    if (command.type === 'resize') session.resize(command.columns, command.rows)
    if (command.type === 'close') { session.close(); await session.completed }
    return session.view(command.type === 'poll' ? command.after : Number.MAX_SAFE_INTEGER)
  }

  cancelPod(podId: string): void {
    for (const session of this.sessions.values()) {
      if (session.podId === podId) session.close()
    }
  }

  cancelAll(): void { for (const session of this.sessions.values()) session.close() }

  busy(): boolean { return [...this.sessions.values()].some(session => session.view().state !== 'closed') }
  async stop(): Promise<void> { for (const session of this.sessions.values()) session.close(); await Promise.all(Array.from(this.sessions.values(), session => session.completed)) }
}
