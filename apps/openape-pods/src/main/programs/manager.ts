import { ApplicationLaunch } from './launch'
import { ExternalShell } from '../shell/session'
import type { ShellRuntime } from '../../runtime/environment'
import { randomUUID } from 'node:crypto'
import { dirname, basename, join  } from 'node:path'
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
import { prepareConsole, podWorkspace } from './console'

export class ProgramManager {
  private launches = new Map<string, ApplicationLaunch>()
  private shells = new Map<string, ExternalShell>()
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

  async replace(podId: string, id: string, epoch: number, definition: ProgramDefinition): Promise<void> {
    const current = await this.assignment(podId, id, epoch)
    await this.dispatch({ type: 'save', podId, id, epoch, configuration: { ...definition, type: 'program', stateId: current.stateId, capability: current.capability, grants: [] } })
  }

  async prepare(podId: string, line: string) {
    return prepareConsole(dirname(this.root), podId, await this.resources(podId), line)
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

  async terminal(command: Exclude<ProgramCommand, { type: 'openShell' } | { type: 'add' } | { type: 'replace' | 'launch' | 'launchStatus' } | { type: 'importState' } | { type: 'prepare' }>): Promise<TerminalView> {
    if (command.type === 'grant') throw new Error('Permission approval requires the owner window')
    if (command.type === 'start') {
      for (const [id, session] of this.sessions) {
        if (session.view().state === 'closed') this.sessions.delete(id)
      }
      if (this.sessions.size >= 4) throw new Error('Close another application terminal first')
      const workspace = await podWorkspace(dirname(this.root), command.podId)
      const id = randomUUID()
      const resource = await this.dispatch({ type: 'reserve', podId: command.podId, applicationId: command.applicationId, epoch: command.epoch, sessionId: id }) as PodResource
      const check = async () => { await this.dispatch({ type: 'check', podId: command.podId, sessionId: id }) }
      const release = async () => { await this.dispatch({ type: 'release', podId: command.podId, sessionId: id }) }
      const session = new ProgramSession(id, command.podId, command.applicationId, resource.configuration as unknown as ProgramAssignment, command.argv, this.helper, this.root, this.credentials, check, release, workspace)
      this.sessions.set(id, session); return session.view()
    }
    const launch = this.launches.get(command.podId)
    if (launch?.id === command.sessionId) {
      if (command.type === 'close') { launch.close(); await launch.completed }
      else if (command.type !== 'poll') {
        throw new Error('Graphical application sessions do not accept terminal input')
      }
      return launch.view()
    }
    const session = this.sessions.get(command.sessionId)
    if (!session || session.podId !== command.podId) throw new Error('Terminal does not belong to this pod or has expired')
    if (command.type === 'input' || command.type === 'resize') await this.dispatch({ type: 'check', podId: command.podId, sessionId: command.sessionId })
    if (command.type === 'input') session.input(command.data)
    if (command.type === 'resize') session.resize(command.columns, command.rows)
    if (command.type === 'close') { session.close(); await session.completed }
    return session.view(command.type === 'poll' ? command.after : Number.MAX_SAFE_INTEGER)
  }

  launchStatus(podId: string): TerminalView | null { return this.launches.get(podId)?.view() ?? null }

  async launch(command: Extract<ProgramCommand, { type: 'launch' }>, runtime: ShellRuntime): Promise<TerminalView> {
    await this.assignment(command.podId, command.applicationId, command.epoch)
    if ([...this.launches.values()].filter(item => item.view().state !== 'closed').length >= 4) throw new Error('Close another application first')
    const state = await this.resources(command.podId); const id = randomUUID()
    const name = await this.dispatch({ type: 'reserveShell', podId: command.podId, epoch: command.epoch, sessionId: id }) as string
    const shell = new ExternalShell(command.podId, dirname(this.root), runtime, state, this.credentials, this.connections,
      async () => { await this.dispatch({ type: 'check', podId: command.podId, sessionId: id }) },
      async () => { await this.dispatch({ type: 'release', podId: command.podId, sessionId: id }) }, name, command.applicationId)
    const launch = new ApplicationLaunch(id, command.podId, shell)
    this.launches.set(command.podId, launch)
    try { await shell.ready }
    catch (error) { await launch.completed; await this.dispatch({ type: 'release', podId: command.podId, sessionId: id }); throw error }
    return launch.view()
  }

  async openShell(podId: string, runtime: ShellRuntime): Promise<string> {
    const previous = this.shells.get(podId)
    if (previous) throw new Error(previous.error ?? 'This pod already has an external terminal; close it first')
    const state = await this.resources(podId)
    const sessionId = randomUUID()
    const name = await this.dispatch({ type: 'reserveShell', podId, epoch: state.epoch, sessionId }) as string
    const shell = new ExternalShell(podId, dirname(this.root), runtime, state, this.credentials, this.connections,
      async () => { await this.dispatch({ type: 'check', podId, sessionId }) },
      async () => { await this.dispatch({ type: 'release', podId, sessionId }) }, name)
    this.shells.set(podId, shell)
    const observe = async () => { await shell.completed; if (!shell.error || shell.closed) this.shells.delete(podId) }
    void observe()
    try { return await shell.ready }
    catch (error) { await this.dispatch({ type: 'release', podId, sessionId }); this.shells.delete(podId); throw error }
  }

  cancelPod(podId: string): void {
    this.launches.get(podId)?.close()
    this.shells.get(podId)?.close()
    for (const session of this.sessions.values()) {
      if (session.podId === podId) session.close()
    }
  }

  cancelAll(): void { for (const launch of this.launches.values()) launch.close(); for (const shell of this.shells.values()) shell.close(); for (const session of this.sessions.values()) session.close() }

  busy(): boolean { return [...this.launches.values()].some(launch => launch.view().state !== 'closed') || this.shells.size > 0 || [...this.sessions.values()].some(session => session.view().state !== 'closed') }
  async stop(): Promise<void> { for (const launch of this.launches.values()) launch.close(); await Promise.all(Array.from(this.launches.values(), launch => launch.completed)); for (const shell of this.shells.values()) shell.close(); await Promise.all(Array.from(this.shells.values(), shell => shell.completed)); for (const session of this.sessions.values()) session.close(); await Promise.all(Array.from(this.sessions.values(), session => session.completed)) }
}
