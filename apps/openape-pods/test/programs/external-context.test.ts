// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ExternalShell } from '../../src/main/shell/session'
import { podEnvironment } from '../../src/runtime/environment'
import { CredentialCache } from '../../src/main/connections/cache'
import type { ConnectionManager } from '../../src/main/connections/manager'
import type { ResourceState } from '../../src/contracts/resources'

it('keeps generated adapters inside the pod HOME and cleans up a refused setup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pods-shell-path-')); const podId = randomUUID()
  try {
    const runtime = { executable: process.execPath, cli: '/fixture/cli', client: '/fixture/client' }
    const context = await podEnvironment(root, podId, runtime)
    const reference = join(root, 'untouched'); await mkdir(reference); await writeFile(join(reference, 'marker'), 'unchanged')
    await symlink(reference, join(context.home, '.openape'))
    const resources: ResourceState = { epoch: 0, resources: [] }
    const credentials = new CredentialCache(join(root, 'credentials'), { available: () => true, encrypt: value => Buffer.from(value), decrypt: bytes => bytes.toString() })
    const connections = { podConnection: async () => ({ issuer: 'https://unused.example.test', subject: 'fixture@example.test', accessToken: async () => 'synthetic' }) } as unknown as ConnectionManager
    let released = false
    const session = new ExternalShell(podId, root, runtime, resources, credentials, connections, async () => {}, async () => { released = true })
    try { await expect(session.ready).rejects.toThrow('symbolic') }
    finally { session.close(); await session.completed }
    expect(released).toBe(true)
    expect(await readdir(reference)).toEqual(['marker']); expect(await readFile(join(reference, 'marker'), 'utf8')).toBe('unchanged')
    expect(await readdir(join(root, 'credentials/temporary'))).toEqual([])
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
