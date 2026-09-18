// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { ProgramControl } from '../../src/worker/resources/programs'
import { RunStore } from '../../src/worker/runs/store'
import { installExample } from '../../src/worker/runs/examples'
import { parseCommandLine, parseProgramCommand } from '../../src/contracts/programs'
import type { ProgramAssignment } from '../../src/contracts/programs'
import { assignedHttp } from '../../src/main/programs/http-service'
import { assertDataIdle } from '../../src/worker/data/backup'

const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } })
function fixture() {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-program-control-'))); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  const pod = store.createPod({ name: 'Application fixture' })
  const id = randomUUID()
  const configuration: ProgramAssignment = { type: 'program', name: 'fixture', executable: '/fixture', executableHash: 'a'.repeat(64), cliId: 'fixture', adapterPath: '/fixture.toml', adapterHash: 'b'.repeat(64), entryFiles: [], environment: {}, networkHosts: [], stateId: randomUUID(), capability: `tool.app_${id.replaceAll('-', '')}.invoke`, grants: [] }
  const control = new ProgramControl(store, resources)
  control.execute({ type: 'save', podId: pod.id, id, epoch: 0, configuration })
  installExample(store, resources, pod.id, 'deterministic', 'c'.repeat(64))
  return { store, resources, pod, id, control, configuration, runs: new RunStore(store) }
}
it('excludes a pod run and data maintenance while its terminal owns the lease', () => {
  const f = fixture(); const sessionId = randomUUID(); const epoch = f.resources.epoch(f.pod.id)
  f.control.execute({ type: 'reserve', podId: f.pod.id, applicationId: f.id, epoch, sessionId })
  expect(() => f.runs.reserve(f.pod.id, f.store.getPod(f.pod.id).activeScript!, epoch)).toThrow('terminal')
  expect(() => assertDataIdle(f.store)).toThrow('active work')
  expect(() => f.control.execute({ type: 'check', podId: f.pod.id, sessionId: randomUUID() })).toThrow('changed')
  f.control.execute({ type: 'release', podId: f.pod.id, sessionId })
  const run = f.runs.reserve(f.pod.id, f.store.getPod(f.pod.id).activeScript!, epoch)
  expect(() => f.control.execute({ type: 'reserve', podId: f.pod.id, applicationId: f.id, epoch, sessionId })).toThrow('terminal')
  f.runs.finish(run.run.id, 'completed', 'Fixture', null)
})
it('fences changed resources and prevents borrowing another pod application', () => {
  const f = fixture(); const other = f.store.createPod({ name: 'Other' }); const sessionId = randomUUID()
  expect(() => f.control.execute({ type: 'reserve', podId: other.id, applicationId: f.id, epoch: 0, sessionId })).toThrow('not assigned')
  f.control.execute({ type: 'reserve', podId: f.pod.id, applicationId: f.id, epoch: f.resources.epoch(f.pod.id), sessionId })
  f.resources.revoke(f.pod.id, f.id, 1)
  expect(() => f.control.execute({ type: 'check', podId: f.pod.id, sessionId })).toThrow('changed')
  expect(f.store.db.prepare('SELECT count(*) AS total FROM program_leases').get()?.total).toBe(1)
})
it('bounds terminal commands and parses quotes without executing shell interpolation', () => {
  expect(parseCommandLine('pods read --folder "Sent Items"')).toEqual(['pods', 'read', '--folder', 'Sent Items'])
  for (const line of ['read; send', 'read | sh', 'read $(id)', '"unclosed']) expect(() => parseCommandLine(line)).toThrow()
  const base = { type: 'input', podId: randomUUID(), sessionId: randomUUID(), data: 'ä\r' }
  expect(parseProgramCommand(base)).toEqual(base)
  expect(() => parseProgramCommand({ ...base, data: 'x'.repeat(8193) })).toThrow('limit')
  expect(() => parseProgramCommand({ ...base, shell: '/bin/sh' })).toThrow('Unsupported')
})
it('keeps HTTP origin, method and pod identity checks independent of declared capability', () => {
  const f = fixture(); const authority = { identity: { podId: f.pod.id, connectionId: randomUUID(), issuer: 'https://id.example.invalid', owner: 'owner@example.invalid', subject: 'pod@example.invalid', keyId: 'key' }, ownerConnection: randomUUID(), grantId: 'http-grant' }
  f.resources.assignHttp(f.pod.id, { origin: 'https://api.example.com', methods: ['POST'] }, authority, f.resources.epoch(f.pod.id))
  const resources = f.resources.list(f.pod.id); const capability = resources.find(item => item.configuration.type === 'http')!.configuration.capability as string
  const scope = { podId: f.pod.id, capabilities: [capability] }; const request = { url: 'https://api.example.com/send', method: 'POST', key: 'mail:1', headers: {} }
  expect(assignedHttp(resources, scope, request)).toEqual(authority)
  expect(() => assignedHttp(resources, { ...scope, podId: randomUUID() }, request)).toThrow('not assigned')
  expect(() => assignedHttp(resources, scope, { ...request, method: 'DELETE' })).toThrow('assigned origin or methods')
  expect(() => assignedHttp(resources, { ...scope, capabilities: [] }, request)).toThrow('not assigned')
})

it('cannot overwrite an application owned by another pod', () => {
  const f = fixture(); const other = f.store.createPod({ name: 'Other' })
  expect(() => f.control.execute({ type: 'save', podId: other.id, id: f.id, epoch: 0, configuration: { ...f.configuration, name: 'Replaced' } })).toThrow('another pod')
  expect(f.resources.list(f.pod.id)[0]?.name).toBe('fixture')
  expect(f.resources.epoch(other.id)).toBe(0)
})

it('rejects renderer paths and arguments on no-argument application launches', () => {
  const command = { type: 'launch', podId: randomUUID(), applicationId: randomUUID(), epoch: 1 }
  expect(parseProgramCommand(command)).toEqual(command)
  expect(() => parseProgramCommand({ ...command, argv: ['ignored'] })).toThrow('Unsupported')
  expect(() => parseProgramCommand({ ...command, executable: '/bin/sh' })).toThrow('Unsupported')
})

it('accepts explicit public application hosts and rejects wildcard or local destinations', () => {
  const base = { type: 'network', podId: randomUUID(), applicationId: randomUUID(), epoch: 2 }
  expect(parseProgramCommand({ ...base, hosts: ['Graph.Microsoft.com'] })).toEqual({ ...base, hosts: ['graph.microsoft.com'] })
  expect(parseProgramCommand({ ...base, hosts: [] })).toEqual({ ...base, hosts: [] })
  for (const hosts of [['*.example.com'], ['localhost'], ['127.0.0.1'], ['api.local'], ['api.example.com:443'], ['api.example.com/path'], ['api.example.com', 'API.EXAMPLE.COM'], ['https://api.example.com'], Array.from({ length: 17 }).fill('api.example.com')]) expect(() => parseProgramCommand({ ...base, hosts })).toThrow()
})
