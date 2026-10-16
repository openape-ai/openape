// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { ProgramManager } from '../../src/main/programs/manager'
import type { ProgramAssignment } from '../../src/contracts/programs'
import { programInvocation } from '../../src/runtime/program-invocation'
import { programLaunch } from '../../src/main/programs/runtime'
import { programRequest } from '../../src/main/programs/invoke'
import type { PodResource } from '../../src/contracts/resources'

const podId = '00000000-0000-4000-8000-000000000001'
const resource: PodResource = { id: '00000000-0000-4000-8000-000000000002', podId, name: 'o365-cli', kind: 'tool', state: 'ready', revision: 1, configuration: { type: 'program', capability: 'tool.mail.invoke' } }
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

it.each(['script', 'inline'])('prepares the actual interpreter, code and complete arguments without executing %s code', async (kind) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-exact-invocation-'))); roots.push(root)
  const executable = await realpath(process.execPath)
  const executableHash = createHash('sha256').update(await readFile(executable)).digest('hex')
  const script = join(root, 'reader.cjs'); const descriptor = join(root, 'runtime.json')
  await writeFile(script, 'throw new Error("Preparation must not execute this script")')
  await writeFile(descriptor, '{}')
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  const assignment: ProgramAssignment = { type: 'program', name: 'logical-reader', cliId: 'logical-reader', executable: script, executableHash: hash(await readFile(script, 'utf8')), stateId: resource.id, capability: 'tool.mail.invoke', networkHosts: [], entryFiles: [], environment: {}, runtime: { executable, executableHash, arguments: kind === 'script' ? ['--use-env-proxy', script] : ['-e', 'throw new Error("Must not execute inline code")'], descriptor: { path: descriptor, hash: hash('{}') }, readDirectories: [], environment: {} } }
  const manager = new ProgramManager(join(root, 'credentials'), '/unused', {} as never, {} as never, async () => ({ resources: [{ ...resource, configuration: assignment as unknown as Record<string, unknown> }], epoch: 1, variables: [] }), async () => {}, () => ({ reach: async () => ({ level: 'owner' }) }) as never)
  const argv = ['list', '--account', 'synthetic@example.test']
  const prepared = await manager.grantCall({ type: 'grant', podId, applicationId: resource.id, epoch: 1, argv })
  expect(prepared.program).toEqual({ name: basename(executable), sha256: executableHash })
  expect(prepared.argv).toEqual([...assignment.runtime!.arguments, ...argv])
  const launch = programLaunch(assignment)
  const executed = await programInvocation(launch.executable, launch.executableHash, [...launch.prefix, ...argv], [], root, launch.environment)
  expect(prepared).toEqual(executed)
  if (kind === 'script') {
    expect(prepared.files).toEqual([{ path: script, sha256: assignment.executableHash }])
    await writeFile(script, 'throw new Error("Changed")')
    await expect(manager.grantCall({ type: 'grant', podId, applicationId: resource.id, epoch: 1, argv })).rejects.toThrow('integrity mismatch')
    await expect(programInvocation(launch.executable, launch.executableHash, prepared.argv, prepared.files!, root, {})).rejects.toThrow('changed before authorization')
  }
})
it('resolves one assigned application by name without an owner-managed ID variable', () => {
  expect(programRequest([resource], podId, ['tool.mail.invoke'], { application: 'o365-cli', argv: ['read'] }).id).toBe(resource.id)
  expect(programRequest([resource], podId, ['tool.mail.invoke'], { applicationId: resource.id, argv: ['read'] }).id).toBe(resource.id)
})
it('rejects foreign, revoked, undeclared, ambiguous and conflicting application selections', () => {
  const invoke = (resources: PodResource[], capabilities = ['tool.mail.invoke']) => programRequest(resources, podId, capabilities, { application: 'o365-cli', argv: ['read'] })
  expect(() => invoke([{ ...resource, podId: 'foreign' }])).toThrow()
  expect(() => invoke([{ ...resource, state: 'revoked' }])).toThrow()
  expect(() => invoke([resource], [])).toThrow()
  expect(() => invoke([resource, { ...resource, id: 'other' }])).toThrow('ambiguous')
  expect(() => programRequest([resource], podId, ['tool.mail.invoke'], { application: 'o365-cli', applicationId: resource.id, argv: ['read'] })).toThrow()
})

it('allows bounded artifact output but cannot increase the program execution time limit', () => {
  const invoke = (options: object) => programRequest([resource], podId, ['tool.mail.invoke'], { application: 'o365-cli', argv: ['read'], ...options })
  expect(invoke({ output: 'artifact', timeoutMs: 15000 })).toMatchObject({ output: 'artifact', timeoutMs: 15000 })
  for (const options of [{ output: '/outside' }, { timeoutMs: 0 }, { timeoutMs: 60001 }, { timeoutMs: Infinity }]) expect(() => invoke(options)).toThrow()
})
