// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { loadAdapter, resolveCommand } from '@openape/apes'
import { ConnectionManager } from '../../src/main/connections/manager'
import { CredentialCache } from '../../src/main/connections/cache'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import type { ProgramAssignment } from '../../src/contracts/programs'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('adopts a CLI-approved grant only for the current pod agent, host and exact command permission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pods-cli-grants-'))
  try {
    const adapterPath = join(root, 'fixture.toml')
    await writeFile(adapterPath, 'schema="openape-shapes/v1"\n[cli]\nid="fixture"\nexecutable="fixture"\naudience="shapes"\n[[operation]]\nid="read"\ncommand=["read"]\ndisplay="Read synthetic state"\naction="read"\nrisk="low"\nresource_chain=["state:*"]\n')
    const assignment = { cliId: 'fixture', adapterPath, adapterHash: createHash('sha256').update(await readFile(adapterPath)).digest('hex'), grants: [] } as unknown as ProgramAssignment
    const podId = randomUUID(); const grantId = randomUUID()
    const identity = { podId, connectionId: randomUUID(), issuer: 'https://id.example.test', subject: 'pod@example.test', owner: 'owner@example.test', keyId: 'fixture' }
    const connection = { ...identity, identity, ownerConnection: randomUUID(), targetHost: `pods:${podId}`, accessToken: async () => 'SYNTHETIC_AGENT' }
    const cache = new CredentialCache(root, { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => '' })
    const manager = new ConnectionManager(root, {} as AgentRuntime, cache, async () => {}, async () => {})
    vi.spyOn(manager, 'podConnection').mockResolvedValue(connection)
    const permission = (await resolveCommand(loadAdapter('fixture', adapterPath), ['fixture', 'read'])).permission
    const request = { requester: identity.subject, audience: 'shapes', target_host: connection.targetHost, permissions: [permission] }
    let data: unknown[] = [null, { id: grantId, status: 'approved', request: { ...request, permissions: 'invalid' } }, { id: grantId, status: 'approved', request: { ...request, target_host: 'another-pod' } }]
    const fetch = vi.fn(async () => Response.json({ data })); vi.stubGlobal('fetch', fetch)
    await expect(manager.existingProgramGrant(podId, assignment, ['read'])).rejects.toThrow('Approve this command')
    data = [{ id: grantId, status: 'approved', request: { ...request, requester: 'another@example.test' } }]
    await expect(manager.existingProgramGrant(podId, assignment, ['read'])).rejects.toThrow('Approve this command')
    data.push({ id: grantId, status: 'approved', request })
    expect(await manager.existingProgramGrant(podId, assignment, ['read'])).toMatchObject({ permission, authority: { identity, grantId } })
    expect(fetch.mock.calls).toHaveLength(3)
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('SYNTHETIC_OWNER')
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
