// @vitest-environment node
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import type { PortableApplication } from '@openape/pods-protocol'
import { portableLauncher, resolveApplicationRequirement } from '../../src/main/programs/requirements'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const requirement: PortableApplication = { key: 'fixture', application: 'fixture', adapter: { identity: 'fixture', version: 1, operations: ['invoke'] }, testedVersions: [], platforms: [{ os: 'darwin', architecture: 'arm64' }], distribution: { kind: 'official-url', url: 'https://untrusted.example/download' }, instructions: 'Select the local fixture' }
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-requirements-'))); roots.push(root)
  const path = join(root, 'fixture'); const adapterPath = join(root, 'fixture.toml')
  await writeFile(path, '#!/bin/sh\nexit 77\n', { mode: 0o700 })
  await writeFile(adapterPath, 'schema="openape-shapes/v1"\n[cli]\nid="fixture"\nexecutable="fixture"\nversion="1"\n[[operation]]\nid="read"\ncommand=["read"]\ndisplay="Read fixture"\naction="read"\nrisk="low"\nresource_chain=["fixture:*"]\n')
  const options = { definitions: join(root, 'definitions'), candidates: [{ path, adapterPath }], searchPath: '', host: { os: 'darwin', architecture: 'arm64' } }
  return { root, path, adapterPath, options }
}
it('resolves installed software without execution, account state, environment or grants', async () => {
  const f = await fixture()
  const result = await resolveApplicationRequirement(requirement, f.options)
  expect(result).toMatchObject({ status: 'available', version: null, testedVersion: false, identitySource: 'local-adapter', software: { kind: 'program', definition: { executable: f.path, environment: {}, networkHosts: [] } } })
  if (result.status !== 'available' || result.software.kind !== 'program') throw new Error('Expected available software')
  expect(result.software.definition).not.toHaveProperty('stateId'); expect(result.software.definition).not.toHaveProperty('grants')
  const oldHash = result.software.definition.executableHash
  await writeFile(f.path, 'REPLACED_EXECUTABLE')
  const refreshed = await resolveApplicationRequirement(requirement, f.options)
  expect(refreshed).toMatchObject({ status: 'available' })
  expect(refreshed.status === 'available' && refreshed.software.kind === 'program' && refreshed.software.definition.executableHash).not.toBe(oldHash)
})
it('requires setup for unknown CLI versions and refuses incompatible adapters', async () => {
  const f = await fixture()
  expect(await resolveApplicationRequirement({ ...requirement, testedVersions: ['2.0.0'] }, f.options)).toMatchObject({ status: 'setupRequired', reason: 'Application version cannot be verified without an approved execution' })
  expect(await resolveApplicationRequirement({ ...requirement, adapter: { ...requirement.adapter, identity: 'another' } }, f.options)).toMatchObject({ status: 'incompatible' })
  await writeFile(f.adapterPath, (await readFile(f.adapterPath, 'utf8')).replace('version="1"', 'version="2"'))
  expect(await resolveApplicationRequirement(requirement, f.options)).toMatchObject({ status: 'incompatible' })
})
it('distinguishes missing software, unsupported platforms and a missing local adapter', async () => {
  const f = await fixture()
  expect(await resolveApplicationRequirement(requirement, { ...f.options, candidates: [] })).toEqual({ status: 'missing' })
  expect(await resolveApplicationRequirement(requirement, { ...f.options, host: { os: 'linux', architecture: 'x64' } })).toMatchObject({ status: 'unsupported' })
  expect(await resolveApplicationRequirement(requirement, { ...f.options, candidates: [], searchPath: f.root })).toMatchObject({ status: 'setupRequired' })
})
it('requires a choice between distinct installations and respects the owner selection', async () => {
  const f = await fixture(); const other = join(f.root, 'other'); await writeFile(other, 'OTHER', { mode: 0o700 })
  const selected = { path: other, adapterPath: f.adapterPath }
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
  await expect(readFile(join(f.root, 'definitions'))).rejects.toThrow('ENOENT')
  expect(readPlist).toHaveBeenCalledWith(join(path, 'Contents/Info.plist'))
  expect(await resolveApplicationRequirement({ ...bundle, testedVersions: ['3.0'] }, options)).toMatchObject({ status: 'incompatible' })
  expect(await resolveApplicationRequirement({ ...bundle, application: 'ai.example.other' }, { ...options, selected: { path } })).toMatchObject({ status: 'incompatible' })
})
it('keeps a usable candidate when another local adapter is malformed', async () => {
  const f = await fixture(); const malformed = join(f.root, 'malformed.toml'); await writeFile(malformed, 'not valid TOML')
  const options = { ...f.options, candidates: [{ path: f.path, adapterPath: malformed }, ...f.options.candidates] }
  expect(await resolveApplicationRequirement(requirement, options)).toMatchObject({ status: 'available' })
  expect(await resolveApplicationRequirement(requirement, { ...options, selected: { path: f.path, adapterPath: malformed } })).toMatchObject({ status: 'setupRequired' })
})
it('ignores unrelated known installations while preserving explicit selection feedback', async () => {
  const f = await fixture()
  await writeFile(f.adapterPath, (await readFile(f.adapterPath, 'utf8')).replace('executable="fixture"', 'executable="unrelated"'))
  expect(await resolveApplicationRequirement(requirement, f.options)).toEqual({ status: 'missing' })
  expect(await resolveApplicationRequirement(requirement, { ...f.options, selected: f.options.candidates[0] })).toMatchObject({ status: 'incompatible' })
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
  await expect(bundleDefinition(result.software.bundle, f.options.definitions)).rejects.toThrow('Application changed')
  await expect(readFile(f.options.definitions)).rejects.toThrow('ENOENT')
})
