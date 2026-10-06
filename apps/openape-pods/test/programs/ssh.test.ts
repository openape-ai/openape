// @vitest-environment node
import { PassThrough } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { parseResourceCommand } from '../../src/contracts/resources'
import type { PodResource } from '../../src/contracts/resources'
import { assignedSsh, parseSshTarget } from '../../src/contracts/ssh'
import type { SshBinding } from '../../src/contracts/ssh'
import { collectInventory, invokeSsh } from '../../src/main/ssh/invoke'
import { inventoryCommand, inventoryProfile, parseInventoryOutput } from '../../src/main/ssh/profile'
import type { ProcessDomain } from '../../src/worker/runtime/sandbox'
import type { CredentialCache } from '../../src/main/connections/cache'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import type { ProgramAuthority } from '../../src/main/programs/grants'

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), authorize: vi.fn(), assertActive: vi.fn(), launch: vi.fn() }))
vi.mock('../../src/main/ssh/configuration', () => ({ resolveSshTarget: mocks.resolve, sshConfiguration: () => 'fixed-config', sshGrantArgv: () => ['pod-ssh', 'inventory', '--binding', 'hash', '--profile', 'linde-server-v1'] }))
vi.mock('../../src/main/broker/authorization', () => ({ AgentAuthority: class { authorize = mocks.authorize; assertActive = mocks.assertActive } }))
vi.mock('../../src/main/connections/agent', () => ({ PodIdentityManager: class { connection() { return {} } } }))
vi.mock('../../src/worker/runtime/sandbox', () => ({ superviseProcess: mocks.launch }))
vi.mock('@openape/apes', () => ({ loadAdapter: () => ({ digest: 'digest' }), resolveCommand: async () => ({ permission: 'ssh-read' }) }))
afterEach(() => vi.resetAllMocks())
const podId = '00000000-0000-4000-8000-000000000001'
const binding: SshBinding = { profileHash: 'a'.repeat(64), target: { alias: 'fixture.example', jumps: ['jump.example'], profile: 'linde-server-v1' }, hosts: [], knownHosts: [] }
const capability = 'tool.ssh_fixture.read'
const authority = { identity: { podId }, grantId: 'approved' } as ProgramAuthority
const resources: PodResource[] = [{ id: podId, podId, revision: 1, kind: 'tool', state: 'ready', name: 'Fixture', configuration: { type: 'sshInventory', ...binding, capability, authority } }]
const scope = { podId, runId: podId, epoch: 1, assignmentRevision: 1, capabilities: [capability] }
const facts = { observedAt: '2026-09-30T12:00:00Z', rebootRequired: false, os: { value: 'Debian' }, kernel: { value: '6.1', exitCode: 0 }, packages: { error: 'unavailable' }, candidates: { value: '' }, packageRefresh: { value: '' }, services: { value: '' }, disk: { value: '' }, backup: { error: 'unavailable' }, certificates: [], authHealth: [] }
const output = JSON.stringify({ version: 1, profile: 'linde-server-v1', facts })
function processFixture() {
  let finish: (code: number) => void = () => {}
  const completed = new Promise<number>((resolve) => { finish = resolve })
  const domain = { stdout: new PassThrough(), stderr: new PassThrough(), processId: Promise.resolve(42), completed, cancel: vi.fn(() => finish(130)) } as unknown as ProcessDomain
  return { domain, finish }
}
it('rejects arbitrary commands, injected aliases, unassigned targets and undeclared capabilities', () => {
  expect(parseResourceCommand({ type: 'assignSsh', podId, epoch: 1, target: binding.target })).toMatchObject({ target: binding.target })
  for (const target of [{ ...binding.target, alias: '-oProxyCommand=evil' }, { ...binding.target, command: 'id' }, { ...binding.target, jumps: ['a;id'] }, { ...binding.target, profile: 'shell' }]) expect(() => parseSshTarget(target)).toThrow()
  for (const body of [{ sshInventory: podId, command: 'id' }, { sshInventory: 'other' }, { sshInventory: podId, argv: [] }]) expect(() => assignedSsh(resources, podId, scope.capabilities, body)).toThrow()
  expect(() => assignedSsh(resources, podId, [], { sshInventory: podId })).toThrow()
  expect(() => assignedSsh(resources.map(item => ({ ...item, state: 'revoked' })), podId, scope.capabilities, { sshInventory: podId })).toThrow()
  expect(() => parseResourceCommand({ type: 'approveSsh', podId, epoch: 1, binding, authority })).toThrow()
})
it('refuses changed route metadata, stale assignment and revoked grants before starting SSH', async () => {
  const input = { resources, scope, body: { sshInventory: podId }, dist: '/unused', root: '/unused', credentials: {} as CredentialCache, signal: new AbortController().signal, check: vi.fn() }
  mocks.resolve.mockResolvedValue({ ...binding, hosts: ['changed'] })
  await expect(invokeSsh(input)).rejects.toThrow('configuration changed')
  mocks.resolve.mockResolvedValue(binding)
  mocks.authorize.mockRejectedValueOnce(new Error('Permission revoked'))
  await expect(invokeSsh(input)).rejects.toThrow('revoked')
  input.check.mockRejectedValueOnce(new Error('Resource permissions changed'))
  await expect(invokeSsh(input)).rejects.toThrow('permissions changed')
  expect(mocks.launch).not.toHaveBeenCalled()
})
it('returns structured observations and discards failed or malformed remote output', async () => {
  const fixture = processFixture()
  const result = collectInventory(fixture.domain, new AbortController().signal, async () => {})
  fixture.domain.stdout.emit('data', Buffer.from(output)); fixture.finish(0)
  await expect(result).resolves.toMatchObject({ facts: { rebootRequired: false } })
  expect(() => parseInventoryOutput(JSON.stringify({ version: 1, profile: 'linde-server-v1', facts: { ...facts, secrets: 'hidden' } }))).toThrow()
  expect(() => parseInventoryOutput('not-json')).toThrow()
  const failed = processFixture(); const rejected = collectInventory(failed.domain, new AbortController().signal, async () => {})
  failed.finish(255); await expect(rejected).rejects.toThrow('exit 255')
})
it('cancels the supervised process on timeout, abort, oversized output and authority loss', async () => {
  for (const reason of ['timeout', 'abort', 'output', 'authority']) {
    const fixture = processFixture(); const controller = new AbortController()
    const result = collectInventory(fixture.domain, controller.signal, async () => { if (reason === 'authority') throw new Error('revoked') }, 10)
    const rejected = expect(result).rejects.toThrow()
    if (reason === 'abort') controller.abort(new Error('cancelled'))
    if (reason === 'output') fixture.domain.stdout.emit('data', Buffer.alloc(128 * 1024 + 1))
    if (reason === 'authority') fixture.finish(0)
    await rejected
    expect(fixture.domain.cancel).toHaveBeenCalled()
  }
})
it('persists revocable SSH resources and fences changes by Pod identity and resource epoch', () => {
  const root = mkdtempSync(join(tmpdir(), 'pods-ssh-')); const store = new PodDatabase(root)
  try {
    const pod = store.createPod({ name: 'Inventory' }); const registry = new ResourceRegistry(store, vi.fn())
    const grant = { ...authority, identity: { ...authority.identity, podId: pod.id } }
    registry.assignSsh(pod.id, binding, grant, 0)
    expect(registry.list(pod.id)[0]).toMatchObject({ kind: 'tool', state: 'ready', configuration: { type: 'sshInventory' } })
    expect(() => registry.assignSsh(pod.id, binding, grant, 0)).toThrow('permissions changed')
    expect(() => registry.assignSsh(pod.id, binding, authority, 1)).toThrow('permissions changed')
    registry.assignSsh(pod.id, binding, grant, 1)
    expect(registry.list(pod.id).map(item => item.state)).toEqual(['revoked', 'ready'])
    const active = registry.list(pod.id)[1]!
    registry.revoke(pod.id, active.id, active.revision)
    expect(() => registry.assertCurrent(pod.id, 2)).toThrow('permissions changed')
  }
  finally { store.close(); rmSync(root, { recursive: true, force: true }) }
})
it('ships one fixed read profile with no maintenance commands or application secret files', () => {
  expect(inventoryCommand()).toContain('sudo -n /usr/bin/python3 -c')
  expect(inventoryProfile).toContain('apt-cache')
  expect(inventoryProfile).not.toMatch(/apt-get|certbot|systemctl.*restart|\.env|ecosystem/)
})

it('stops a still-running SSH process when its grant is revoked during collection', async () => {
  const fixture = processFixture()
  const check = vi.fn(async () => { throw new Error('Permission revoked') })
  await expect(collectInventory(fixture.domain, new AbortController().signal, check, 2500)).rejects.toThrow('revoked')
  expect(fixture.domain.cancel).toHaveBeenCalled()
  expect(check).toHaveBeenCalledTimes(1)
})
