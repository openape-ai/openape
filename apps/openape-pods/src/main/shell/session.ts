import { programLaunch, verifyProgramRuntime } from '../programs/runtime'
import { constants } from 'node:fs'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import type { Socket } from 'node:net'
import type { ProgramAssignment } from '../../contracts/programs'
import type { ResourceState } from '../../contracts/resources'
import type { CredentialCache } from '../connections/cache'
import type { ConnectionManager } from '../connections/manager'
import { launchDescriptor, verifyApplicationBundle } from '../programs/application'
import { ProgramState } from '../programs/state'
import { verifyExecutable } from '../../worker/runtime/sandbox'
import { podDirectory, podEnvironment, quoteShell } from '../../runtime/environment'
import type { ShellRuntime } from '../../runtime/environment'
import { shellIdentity } from './identity'

export class ExternalShell {
  readonly id = randomUUID()
  readonly ready: Promise<string>
  readonly completed: Promise<void>
  private socket?: Socket
  private stopping = false
  private finish?: (error?: Error) => void
  error: string | null = null
  closed = false

  constructor(readonly podId: string, root: string, runtime: ShellRuntime, resources: ResourceState, credentials: CredentialCache, connections: ConnectionManager, check: () => Promise<void>, release: () => Promise<void>, name = podId, private readonly launchApplication?: string) {
    let ready!: (file: string) => void; let failed!: (error: unknown) => void
    this.ready = new Promise((resolve, reject) => { ready = resolve; failed = reject })
    this.completed = this.run(root, runtime, resources, credentials, connections, check, release, ready, name).catch((error: unknown) => { this.error = error instanceof Error ? error.message : 'Pod terminal failed'; failed(error) })
  }

  close(): void { this.stopping = true; if (this.socket) this.socket.write('{"stop":true}\n'); else this.finish?.(new Error('Pod terminal was closed before attaching')) }

  private async run(root: string, runtime: ShellRuntime, resources: ResourceState, credentials: CredentialCache, connections: ConnectionManager, check: () => Promise<void>, release: () => Promise<void>, ready: (file: string) => void, name: string): Promise<void> {
    await check()
    const context = await podEnvironment(root, this.podId, runtime)
    const temporary = await mkdtemp(join(tmpdir(), 'pod-shell-'))
    let identity: Awaited<ReturnType<typeof shellIdentity>> | undefined
    try {
      await chmod(temporary, 0o700)
      identity = await shellIdentity(root, this.podId, connections)
      await this.serve(temporary, context, identity, runtime, resources, credentials, check, release, ready, name)
    }
    finally { await identity?.close(); await rm(temporary, { recursive: true, force: true }) }
  }

  private async serve(temporary: string, context: Awaited<ReturnType<typeof podEnvironment>>, identity: Awaited<ReturnType<typeof shellIdentity>>, runtime: ShellRuntime, resources: ResourceState, credentials: CredentialCache, check: () => Promise<void>, release: () => Promise<void>, ready: (file: string) => void, name: string): Promise<void> {
    const token = randomBytes(32).toString('hex'); const endpoint = join(temporary, 'control.sock')
    let resolveDone!: () => void; let failure: Error | undefined
    const done = new Promise<void>((resolve) => { resolveDone = resolve })
    this.finish = (error) => { failure ??= error; resolveDone() }
    let lastHeartbeat = Date.now(); let attached = false; let finished = false
    const peers = new Set<Socket>()
    const server = createServer((socket) => {
      peers.add(socket); socket.setTimeout(10000, () => socket.destroy())
      let authenticated = false; let buffer = ''
      socket.on('error', (error) => { if (authenticated) this.finish?.(error) })
      socket.on('data', (bytes) => {
        buffer += bytes.toString()
        if (buffer.length > 4096) { socket.destroy(); return }
        for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
          try {
            const frame = JSON.parse(line) as { token?: string, type?: string, code?: number }
            if (!authenticated) {
              const candidate = Buffer.from(frame.token ?? '')
              if (attached || candidate.length !== token.length || !timingSafeEqual(candidate, Buffer.from(token)) || frame.type !== 'attach') { socket.destroy(); return }
              authenticated = true; socket.setTimeout(0); attached = true; this.socket = socket; socket.write('{"ready":true}\n')
              if (this.stopping) socket.write('{"stop":true}\n')
            }
            else if (frame.type === 'done') {
              if (!Number.isInteger(frame.code)) throw new Error('Invalid pod terminal exit status')
              finished = true; this.closed = true
              this.finish?.(frame.code === 0 ? undefined : new Error('Pod shell exited unsuccessfully; application setup changes were not saved'))
            }
            else if (frame.type !== 'heartbeat') {
              throw new Error('Invalid pod terminal control message')
            }
            lastHeartbeat = Date.now()
          }
          catch (error) { socket.destroy(); if (authenticated) this.finish?.(error instanceof Error ? error : new Error('Invalid pod terminal control message')) }
        }
      })
      socket.on('close', () => { peers.delete(socket); if (authenticated && !finished) this.finish?.(new Error('Pod terminal disconnected; application setup changes were not saved')) })
    })
    let timer: ReturnType<typeof setInterval> | undefined
    const applications = resources.resources.filter(item => item.state === 'ready' && item.configuration.type === 'program' && (!this.launchApplication || item.id === this.launchApplication))
    const launchCommand = this.launchApplication ? `pod-open-${this.launchApplication.replaceAll('-', '')}-${String(applications[0]?.configuration.executableHash).slice(0, 16)}` : undefined
    if (this.launchApplication && applications.length !== 1) throw new Error('Application is not assigned to this pod')
    const wrappers: string[] = []
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve) }); await chmod(endpoint, 0o600)
      server.on('error', error => this.finish?.(error))
      let checking = false
      timer = setInterval(() => {
        if (checking) return
        checking = true
        void (async () => {
          try {
            identity.assertActive(); await check()
            if (Date.now() - lastHeartbeat > (attached ? 20000 : 120000)) throw new Error('Pod terminal connection expired')
          }
          catch (error) { this.close(); this.finish?.(error instanceof Error ? error : new Error('Pod terminal permissions changed')) }
          finally { checking = false }
        })()
      }, 1000)
      const configuration = await podDirectory(context.home, '.openape')
      const shapes = await podDirectory(configuration, 'shapes')
      const adapters = await podDirectory(shapes, 'adapters')
      const state = new ProgramState(credentials)
      const names = applications.map(item => String(item.configuration.cliId))
      if (new Set(names).size !== names.length) throw new Error('Application command is ambiguous; remove the duplicate assignment in Permissions')
      const mount = async (index: number): Promise<void> => {
        const resource = applications[index]
        if (resource) {
          const assignment = resource.configuration as unknown as ProgramAssignment
          if (!/^[\w-]+$/.test(assignment.cliId) || ['node', 'apes', 'ape-shell'].includes(assignment.cliId)) throw new Error('Application command conflicts with the pod shell')
          await verifyApplicationBundle(assignment)
          await verifyProgramRuntime(assignment)
          await verifyExecutable(assignment.executable, assignment.executableHash)
          await verifyExecutable(assignment.adapterPath, assignment.adapterHash)
          const destination = join(adapters, `${assignment.cliId}.toml`)
          await rm(destination, { force: true })
          await copyFile(assignment.adapterPath, destination, constants.COPYFILE_EXCL)
          for (const file of assignment.entryFiles) await verifyExecutable(file.path, file.hash)
          await state.use(assignment.stateId, { podId: this.podId, applicationId: resource.id }, async (home) => {
            const launch = programLaunch(assignment)
            const invocation = [launch.executable, ...launch.prefix].map(quoteShell).join(' ')
            const environment = Object.entries({ ...launch.environment, HOME: home, TMPDIR: home }).map(([key, value]) => quoteShell(`${key}=${value}`)).join(' ')
            const suffix = assignment.cacheArgument ? ` ${quoteShell(assignment.cacheArgument)} ${quoteShell(home)}` : ''
            const wrapper = join(context.bin, assignment.cliId); wrappers.push(wrapper)
            await writeFile(wrapper, `#!/bin/sh\nexec /usr/bin/env -u ELECTRON_RUN_AS_NODE ${environment} ${invocation} "$@"${suffix}\n`, { mode: 0o700 })
            if (launchCommand) {
              const launcher = join(context.bin, launchCommand); wrappers.push(launcher)
              await writeFile(join(adapters, `${launchCommand}.toml`), launchDescriptor(launchCommand, resource.name), { mode: 0o600 })
              await writeFile(launcher, `#!/bin/sh\nexec /usr/bin/env -u ELECTRON_RUN_AS_NODE ${environment} ${quoteShell(assignment.executable)}\n`, { mode: 0o700 })
            }
            await mount(index + 1)
          })
          return
        }
        const config = join(temporary, 'session.json')
        await writeFile(config, JSON.stringify({ endpoint, token, name, command: launchCommand, podId: this.podId, workspace: context.workspace, environment: { ...context.environment, APES_AUTH_FILE: identity.path }, executable: runtime.executable, cli: runtime.cli }), { mode: 0o600 })
        const launcher = join(temporary, 'Open Pod Terminal.command')
        await writeFile(launcher, `#!/bin/sh\nexec /usr/bin/env -i PATH=/usr/bin:/bin ELECTRON_RUN_AS_NODE=1 ${quoteShell(runtime.executable)} ${quoteShell(runtime.client)} ${quoteShell(config)}\n`, { mode: 0o700 })
        ready(launcher)
        if (this.stopping) this.close()
        await done
        if (failure) throw failure
        await check()
      }
      await mount(0); this.socket?.end('{"saved":true}\n')
    }
    catch (error) {
      this.socket?.end(`${JSON.stringify({ error: error instanceof Error ? error.message : 'Pod terminal failed' })}\n`)
      throw error
    }
    finally {
      if (timer) clearInterval(timer)
      server.close()
      for (const peer of peers) { if (peer !== this.socket) peer.destroy() }
      for (const wrapper of wrappers) await rm(wrapper, { force: true })
      if (finished || !attached) await release()
    }
  }
}
