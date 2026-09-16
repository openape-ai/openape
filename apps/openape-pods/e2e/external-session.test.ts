import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { ExternalShell } from '../src/main/shell/session'
import { CredentialCache } from '../src/main/connections/cache'
import type { ConnectionManager } from '../src/main/connections/manager'
import { ProgramState } from '../src/main/programs/state'
import type { ResourceState } from '../src/contracts/resources'

it('external shell: opens the real client and persists harmless application setup for a later invocation', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-external-session-')))
  const podId = randomUUID(); const applicationId = randomUUID(); let origin = ''
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/.well-known/openid-configuration') {
      response.end(JSON.stringify({ grants_endpoint: `${origin}/api/grants` }))
    }
    else if (request.url?.startsWith('/api/grants?')) {
      response.end(JSON.stringify({ data: [{ id: 'synthetic', status: 'approved', request: { audience: 'ape-shell', target_host: `pods:${podId}`, grant_type: 'timed' } }] }))
    }
    else { response.statusCode = 404; response.end('{}') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const credentials = new CredentialCache(join(root, 'credentials'), { available: () => true, encrypt: value => Buffer.from(value), decrypt: bytes => bytes.toString() })
  const stateId = await new ProgramState(credentials).create({ podId, applicationId })
  const executable = join(root, 'fixture'); const adapterPath = join(root, 'fixture.toml')
  await writeFile(executable, '#!/bin/sh\nif [ "$1" = setup ]; then printf synthetic-configuration > "$HOME/state.txt"; else cat "$HOME/state.txt"; fi\n', { mode: 0o700 })
  await writeFile(adapterPath, 'schema="openape-shapes/v1"\n[cli]\nid="fixture"\nexecutable="fixture"\naudience="shapes"\n[[operation]]\nid="setup"\ncommand=["setup"]\ndisplay="Synthetic setup"\naction="write"\nrisk="low"\nresource_chain=["state:*"]\n')
  const hash = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex')
  const state: ResourceState = { epoch: 1, resources: [{ id: applicationId, podId, name: 'Fixture', revision: 1, kind: 'tool', state: 'ready', configuration: { type: 'program', cliId: 'fixture', executable, executableHash: await hash(executable), adapterPath, adapterHash: await hash(adapterPath), entryFiles: [], environment: {}, stateId, grants: [] } }] }
  const connections = { podConnection: async () => ({ issuer: origin, subject: 'pod@example.test', accessToken: async () => 'synthetic-token' }) } as unknown as ConnectionManager
  let released = 0
  const runtime = { executable: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), cli: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/Resources/apes/ape-shell.mjs'), client: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/Resources/app.asar.unpacked/dist/runtime/shell-client.mjs') }
  const session = new ExternalShell(podId, root, runtime, state, credentials, connections, async () => {}, async () => { released++ })
  try {
    const launcher = await session.ready
    const require = createRequire(resolve('../../packages/apes/package.json'))
    const pty = require('@lydell/node-pty') as typeof import('@lydell/node-pty')
    const terminal = pty.spawn('/bin/sh', [launcher], { cwd: root, cols: 100, rows: 30, env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color' } })
    let output = ''; terminal.onData((bytes) => { output += bytes })
    const exited = new Promise<number>(resolve => terminal.onExit(event => resolve(event.exitCode)))
    try {
      await expect.poll(() => output).toContain('apes$ ')
      expect(output).toContain(`HOME: ${join(root, 'pods', podId, 'home')}`)
      expect(output).toContain(`Workspace: ${join(root, 'pods', podId, 'workspace')}`)
      expect(released).toBe(0)
      terminal.write('fixture setup; printf "SETUP_SAVED\\n"\r')
      await expect.poll(() => output).toContain('\r\nSETUP_SAVED')
      terminal.write('exit\r'); expect(await exited).toBe(0)
      await session.completed
      expect(session.error).toBeNull(); expect(released).toBe(1)
      const saved = await new ProgramState(credentials).use(stateId, { podId, applicationId }, directory => readFile(join(directory, 'state.txt'), 'utf8'))
      expect(saved).toBe('synthetic-configuration')
      expect(await readdir(join(root, 'credentials/temporary'))).toEqual([])
      expect(output).not.toContain('synthetic-token')
    }
    finally { terminal.kill(); await exited }
  }
  finally { session.close(); await session.completed; await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }) }
})
