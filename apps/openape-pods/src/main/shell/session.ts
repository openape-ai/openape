import { programLaunch, verifyProgramRuntime } from '../programs/runtime'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { assignedDirectories, directoryPolicy } from '../../runtime/directories'
import type { ProgramClientConfiguration } from '../../runtime/program-client'
import type { SandboxReach, SandboxLevel  } from '../../contracts/sandbox'
import { registerAuthDomain } from '../connections/ledger'
import { startNetworkProxy } from '../network/proxy'
import { grantSummary } from '../../contracts/grant-summary'
import { createServer } from 'node:net'
import type { Socket } from 'node:net'
import type { ProgramAssignment } from '../../contracts/programs'
import type { ResourceState } from '../../contracts/resources'
import type { CredentialCache } from '../connections/cache'
import type { ConnectionManager } from '../connections/manager'
import { verifyApplicationBundle } from '../programs/application'
import { ProgramState } from '../programs/state'
import { programHome, verifyExecutable } from '../../worker/runtime/sandbox'
import { podDirectory, podEnvironment, quoteShell } from '../../runtime/environment'
import type { ShellRuntime } from '../../runtime/environment'
import { podIdentityFile } from '../connections/identity-file'

export class ExternalShell {
  readonly id = randomUUID()
  readonly ready: Promise<string>
  readonly completed: Promise<void>
  private socket?: Socket
  private stopping = false
  private finish?: (error?: Error) => void
  error: string | null = null
  closed = false

  constructor(readonly podId: string, root: string, runtime: ShellRuntime, resources: ResourceState, credentials: CredentialCache, connections: ConnectionManager, check: () => Promise<void>, release: () => Promise<void>, private readonly level: SandboxLevel, name = podId, private readonly launchApplication?: string, private readonly reach?: SandboxReach) {
    let ready!: (file: string) => void; let failed!: (error: unknown) => void
    this.ready = new Promise((resolve, reject) => { ready = resolve; failed = reject })
    this.completed = this.run(root, runtime, resources, credentials, connections, check, release, ready, name).catch((error: unknown) => { this.error = error instanceof Error ? error.message : 'Pod terminal failed'; failed(error) })
  }

  close(): void { this.stopping = true; if (this.socket) this.socket.write('{"stop":true}\n'); else this.finish?.(new Error('Pod terminal was closed before attaching')) }

  private async run(root: string, runtime: ShellRuntime, resources: ResourceState, credentials: CredentialCache, connections: ConnectionManager, check: () => Promise<void>, release: () => Promise<void>, ready: (file: string) => void, name: string): Promise<void> {
    await check()
    const context = await podEnvironment(root, this.podId, runtime)
    const temporary = await mkdtemp(join(tmpdir(), 'pod-shell-'))
    let identity: Awaited<ReturnType<typeof podIdentityFile>> | undefined
    try {
      await chmod(temporary, 0o700)
      const connection = await connections.podConnection(this.podId)
      identity = await podIdentityFile(root, connection)
      await this.serve(root, temporary, context, identity, connection.targetHost, runtime, resources, credentials, check, release, ready, name)
    }
    finally { await identity?.close(); await rm(temporary, { recursive: true, force: true }) }
  }

  private async serve(root: string, temporary: string, context: Awaited<ReturnType<typeof podEnvironment>>, identity: Awaited<ReturnType<typeof podIdentityFile>>, targetHost: string, runtime: ShellRuntime, resources: ResourceState, credentials: CredentialCache, check: () => Promise<void>, release: () => Promise<void>, ready: (file: string) => void, name: string): Promise<void> {
    const executionRoot = join(root, 'authentication', `shell-${this.id}`)
    await mkdir(executionRoot, { recursive: true, mode: 0o700 })
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
            const frame = JSON.parse(line) as { token?: string, type?: string, code?: number, path?: string, ownerPid?: number }
            if (!authenticated) {
              const candidate = Buffer.from(frame.token ?? '')
              if (candidate.length === token.length && timingSafeEqual(candidate, Buffer.from(token)) && frame.type === 'execution') {
                if (this.stopping || typeof frame.path !== 'string' || !frame.path.startsWith(`${executionRoot}/call-`) || frame.path.includes('/../') || !Number.isSafeInteger(frame.ownerPid) || frame.ownerPid! < 1) throw new Error('Invalid execution domain')
                authenticated = true
                void (async () => { await check(); identity.assertActive(); registerAuthDomain(join(root, 'authentication'), frame.path!, frame.ownerPid!); socket.end('{"registered":true}\n') })().catch(() => socket.destroy())
                return
              }
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
      socket.on('close', () => { peers.delete(socket); if (socket === this.socket && !finished) this.finish?.(new Error('Pod terminal disconnected; application setup changes were not saved')) })
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
      // apes keeps its files in .openape of the Pod HOME; a link planted there must never redirect them outside.
      await podDirectory(context.home, '.openape')
      const state = new ProgramState(credentials)
      const names = applications.map(item => String(item.configuration.cliId))
      if (new Set(names).size !== names.length) throw new Error('Application command is ambiguous; remove the duplicate assignment in Permissions')
      const directories = directoryPolicy(await assignedDirectories(root, this.podId, resources.resources))
      const mount = async (index: number): Promise<void> => {
        const resource = applications[index]
        if (resource) {
          const assignment = resource.configuration as unknown as ProgramAssignment
          if (!/^[\w-]+$/.test(assignment.cliId) || ['node', 'apes', 'ape-shell'].includes(assignment.cliId)) throw new Error('Application command conflicts with the pod shell')
          await verifyApplicationBundle(assignment)
          await verifyProgramRuntime(assignment)
          await verifyExecutable(assignment.executable, assignment.executableHash)
          for (const file of assignment.entryFiles) await verifyExecutable(file.path, file.hash)
          await state.use(assignment.stateId, { podId: this.podId, applicationId: resource.id }, async (home) => {
            const launch = programLaunch(assignment)
            const proxy = this.level === 'isolated' && assignment.networkHosts.length ? await startNetworkProxy(new AbortController().signal, assignment.networkHosts) : undefined
            try {
              const environment = { PATH: '/usr/bin:/bin', PODS_POD_ID: this.podId, ...launch.environment, ...proxy?.environment, APES_AUTH_FILE: identity.path, HOME: programHome({ level: this.level }, home), TMPDIR: this.level === 'owner' ? join(context.home, 'tmp') : home }
              const configuration: ProgramClientConfiguration = {
                helper: join(dirname(runtime.client), '../native/pods-helper'),
                endpoint,
                token,
                privateRoot: executionRoot,
                policy: { reach: this.reach ?? { level: this.level, protectedPaths: [root] }, executable: launch.executable, workspace: context.workspace, readFiles: [identity.path, ...assignment.entryFiles.map(file => file.path)], runtimeDirectories: launch.runtimeDirectories, networkPorts: proxy ? [proxy.port] : [], systemTrust: Boolean(proxy), readDirectories: directories.readDirectories, writeDirectories: [...new Set([home, environment.TMPDIR]), ...directories.writeDirectories] },
                launch: { runtime: { executable: runtime.executable, cli: runtime.cli, environment: { APES_AUTH_FILE: identity.path, APES_IGNORE_USER_CONFIG: '1' } }, targetHost, executableHash: launch.executableHash, files: assignment.entryFiles.map(file => ({ path: file.path, sha256: file.hash })), summary: grantSummary('Run the selected application command', name), waitMs: 15 * 60 * 1000 },
                prefix: launch.prefix,
                suffix: assignment.cacheArgument ? [assignment.cacheArgument, home] : [],
                environment,
              }
              const configurationPath = join(temporary, `application-${resource.id}.json`)
              await writeFile(configurationPath, JSON.stringify(configuration), { mode: 0o600 })
              const invocation = [runtime.executable, join(dirname(runtime.client), 'program-client.mjs'), configurationPath].map(quoteShell).join(' ')
              const wrapper = join(context.bin, assignment.cliId); wrappers.push(wrapper)
              await writeFile(wrapper, `#!/bin/sh\nexec /usr/bin/env ELECTRON_RUN_AS_NODE=1 ${invocation} "$@"\n`, { mode: 0o700 })
              if (launchCommand) {
                const launcher = join(context.bin, launchCommand); wrappers.push(launcher)
                await writeFile(launcher, `#!/bin/sh\nexec /usr/bin/env ELECTRON_RUN_AS_NODE=1 ${invocation}\n`, { mode: 0o700 })
              }
              await mount(index + 1)
            }
            finally { await proxy?.close() }
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
