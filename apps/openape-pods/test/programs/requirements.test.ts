// @vitest-environment node
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import type { PortableApplication } from '@openape/pods-protocol'
import { portableLauncher, portableProgram, resolveApplicationRequirement } from '../../src/main/programs/requirements'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const requirement: PortableApplication = { key: 'fixture', application: 'fixture', adapter: { identity: 'fixture', version: 1, operations: ['invoke'] }, testedVersions: [], platforms: [{ os: 'darwin', architecture: 'arm64' }], distribution: { kind: 'official-url', url: 'https://untrusted.example/download' }, instructions: 'Select the local fixture' }
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-requirements-'))); roots.push(root)
  const path = join(root, 'fixture')
  await writeFile(path, '#!/bin/sh\nexit 77\n', { mode: 0o700 })
  const options = { candidates: [{ path }], searchPath: '', host: { os: 'darwin', architecture: 'arm64' } }
  return { root, path, options }
}
// Issue 1473, revision 4: a package requires a program by its command name; the recipient's IdP decides its commands.
it('resolves installed software by its command name without execution, account state, environment or grants', async () => {
  const f = await fixture()
  const result = await resolveApplicationRequirement(requirement, f.options)
  expect(result).toMatchObject({ status: 'available', version: null, testedVersion: false, identitySource: 'command-name', software: { kind: 'program', definition: { executable: f.path, cliId: 'fixture', environment: {}, networkHosts: [] } } })
  if (result.status !== 'available' || result.software.kind !== 'program') throw new Error('Expected available software')
  expect(result.software.definition).not.toHaveProperty('stateId'); expect(result.software.definition).not.toHaveProperty('grants')
  const oldHash = result.software.definition.executableHash
  await writeFile(f.path, 'REPLACED_EXECUTABLE')
  const refreshed = await resolveApplicationRequirement(requirement, f.options)
  expect(refreshed).toMatchObject({ status: 'available' })
  expect(refreshed.status === 'available' && refreshed.software.kind === 'program' && refreshed.software.definition.executableHash).not.toBe(oldHash)
})
it('requires setup for unknown CLI versions and resolves packages that still name a Shapes adapter by the command name', async () => {
  const f = await fixture()
  expect(await resolveApplicationRequirement({ ...requirement, testedVersions: ['2.0.0'] }, f.options)).toMatchObject({ status: 'setupRequired', reason: 'Application version cannot be verified without an approved execution' })
  expect(await resolveApplicationRequirement({ ...requirement, adapter: { ...portableProgram, operations: ['invoke'] } }, f.options)).toMatchObject({ status: 'available', identitySource: 'command-name' })
  expect(await resolveApplicationRequirement({ ...requirement, adapter: { identity: 'another', version: 2, operations: ['invoke'] } }, f.options)).toMatchObject({ status: 'available', identitySource: 'command-name' })
})
it('distinguishes missing software and unsupported platforms and finds a program on the search path', async () => {
  const f = await fixture()
  expect(await resolveApplicationRequirement(requirement, { ...f.options, candidates: [] })).toEqual({ status: 'missing' })
  expect(await resolveApplicationRequirement(requirement, { ...f.options, host: { os: 'linux', architecture: 'x64' } })).toMatchObject({ status: 'unsupported' })
  expect(await resolveApplicationRequirement(requirement, { ...f.options, candidates: [], searchPath: f.root })).toMatchObject({ status: 'available', software: { kind: 'program', definition: { executable: f.path } } })
})
it('requires a choice between distinct installations and respects the owner selection', async () => {
  const f = await fixture(); const other = join(f.root, 'other', 'fixture'); await mkdir(join(f.root, 'other')); await writeFile(other, 'OTHER', { mode: 0o700 })
  const selected = { path: other }
  const options = { ...f.options, candidates: [...f.options.candidates, selected] }
  expect(await resolveApplicationRequirement(requirement, options)).toMatchObject({ status: 'setupRequired', reason: 'Choose which local application installation to use' })
  expect(await resolveApplicationRequirement(requirement, { ...options, selected })).toMatchObject({ status: 'available', software: { kind: 'program', definition: { executable: other } } })
})
it('matches static bundle declarations and tested versions without launching the application', async () => {
  const f = await fixture(); const path = join(f.root, 'Fixture.app')
  await mkdir(join(path, 'Contents/MacOS'), { recursive: true })
  await writeFile(join(path, 'Contents/MacOS/fixture'), 'SYNTHETIC_APPLICATION', { mode: 0o700 })
  const readPlist = vi.fn(async () => JSON.stringify({ CFBundleExecutable: 'fixture', CFBundleIdentifier: 'AI.Example.Fixture', CFBundleShortVersionString: '2.0' }))
  const bundle = { ...requirement, application: 'ai.example.fixture', adapter: { ...portableLauncher, operations: ['invoke'] }, testedVersions: ['2.0'] }
  const options = { ...f.options, candidates: [{ path }], readPlist }
  expect(await resolveApplicationRequirement(bundle, options)).toMatchObject({ status: 'available', version: '2.0', testedVersion: true, identitySource: 'bundle-declaration', software: { kind: 'bundle', bundle: { bundlePath: path } } })
  expect(readPlist).toHaveBeenCalledWith(join(path, 'Contents/Info.plist'))
  expect(await resolveApplicationRequirement({ ...bundle, testedVersions: ['3.0'] }, options)).toMatchObject({ status: 'incompatible' })
  expect(await resolveApplicationRequirement({ ...bundle, application: 'ai.example.other' }, { ...options, selected: { path } })).toMatchObject({ status: 'incompatible' })
})
it('ignores installations of another name unless the owner selects one, which is then called by the required name', async () => {
  const f = await fixture(); const renamed = join(f.root, 'fixture-2'); await writeFile(renamed, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  expect(await resolveApplicationRequirement(requirement, { ...f.options, candidates: [{ path: renamed }] })).toEqual({ status: 'missing' })
  expect(await resolveApplicationRequirement(requirement, { ...f.options, candidates: [{ path: renamed }], selected: { path: renamed } })).toMatchObject({ status: 'available', software: { kind: 'program', definition: { executable: renamed, cliId: 'fixture' } } })
})
it('refuses a bundle changed after preview before creating its launcher', async () => {
  const f = await fixture(); const path = join(f.root, 'Fixture.app'); const executable = join(path, 'Contents/MacOS/fixture')
  await mkdir(join(path, 'Contents/MacOS'), { recursive: true }); await writeFile(executable, 'BEFORE', { mode: 0o700 })
  const readPlist = async () => JSON.stringify({ CFBundleExecutable: 'fixture', CFBundleIdentifier: 'ai.example.fixture' })
  const result = await resolveApplicationRequirement({ ...requirement, application: 'ai.example.fixture', adapter: { ...portableLauncher, operations: ['invoke'] } }, { ...f.options, candidates: [{ path }], readPlist })
  expect(result.status).toBe('available')
  if (result.status !== 'available' || result.software.kind !== 'bundle') throw new Error('Expected available bundle')
  await writeFile(executable, 'AFTER')
  const { bundleDefinition } = await import('../../src/main/programs/application')
  await expect(bundleDefinition(result.software.bundle)).rejects.toThrow('Application changed')
})
