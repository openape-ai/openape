// @vitest-environment node
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { assertUpdate, verifyUpdate } from '../../src/main/update'
import type { DistributionManifest } from '../../src/main/update'
import { selectProfile, selectedProfile } from '../../src/main/profile'
import { assertPilotRuntime } from '../../src/main/support'
import { CredentialCache } from '../../src/main/connections/cache'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function root() { const path = await realpath(await mkdtemp(join(tmpdir(), 'Pods update '))); roots.push(path); return path }
const current: DistributionManifest = { format: 'openape-pods-distribution', version: '0.1.0', platform: 'darwin', architecture: process.arch, schema: { minimum: 1, current: 10 }, releaseReady: true }
const next = { ...current, version: '0.2.0', schema: { minimum: 9, current: 11 } }
it('rejects downgrades, incompatible schemas, wrong architecture and unapproved release manifests', () => {
  expect(() => assertUpdate(current, next)).not.toThrow()
  for (const candidate of [current, { ...next, version: '0.0.9' }, { ...next, schema: { minimum: 11, current: 12 } }, { ...next, releaseReady: false }, { ...next, architecture: 'wrong' }]) expect(() => assertUpdate(current, candidate)).toThrow()
})
it('requires successful native assessments, the same publisher and the signed bundle version', async () => {
  const base = await root(); const previous = join(base, 'Previous.app'); const candidate = join(base, 'Next.app')
  for (const [path, data] of [[previous, current], [candidate, next]] as const) { await mkdir(join(path, 'Contents/Resources'), { recursive: true }); await writeFile(join(path, 'Contents/Resources/pods-distribution.json'), JSON.stringify(data)) }
  const calls: string[] = []
  const run = async (binary: string, args: string[]) => {
    calls.push([binary, ...args].join(' '))
    return { stdout: args.includes('CFBundleIdentifier') ? 'ai.openape.pods' : args.includes('CFBundleShortVersionString') ? '0.2.0' : '', stderr: 'TeamIdentifier=ABCDEFGHIJ\nflags=0x10000(runtime)\n' }
  }
  expect(await verifyUpdate(previous, candidate, run)).toEqual(next)
  expect(calls.filter(call => call.includes('spctl --assess'))).toHaveLength(2)
  await expect(verifyUpdate(previous, candidate, async (binary, args) => { if (binary.endsWith('spctl')) throw new Error('Unnotarized'); return run(binary, args) })).rejects.toThrow('Unnotarized')
  await expect(verifyUpdate(previous, candidate, async (binary, args) => { const result = await run(binary, args); return args.at(-1) === candidate ? { ...result, stderr: result.stderr.replace('ABCDEFGHIJ', 'ZZZZZZZZZZ') } : result })).rejects.toThrow('publisher')
})
it('selects only private restored profiles and rejects pointer traversal and links', async () => {
  const base = await root(); const profile = join(base, 'profiles', randomUUID()); await mkdir(profile, { recursive: true, mode: 0o700 })
  expect(selectedProfile(base)).toBe(base); selectProfile(base, profile); expect(selectedProfile(base)).toBe(profile)
  await writeFile(join(base, 'selected-profile.json'), JSON.stringify({ profile: '../outside' })); expect(() => selectedProfile(base)).toThrow('path')
  const link = join(base, 'profiles', randomUUID()); await symlink(profile, link); await writeFile(join(base, 'selected-profile.json'), JSON.stringify({ profile: `profiles/${link.split('/').at(-1)}` })); expect(() => selectedProfile(base)).toThrow('links')
})
it('erases only the matching pod key and retries safely after a locked credential store', async () => {
  const base = await root(); let available = true
  const cache = new CredentialCache(base, { available: () => available, encrypt: value => Buffer.from(value), decrypt: value => value.toString() })
  const pod = randomUUID(); const key = randomUUID(); const shared = randomUUID()
  await cache.create(key, JSON.stringify({ podId: pod, privateKey: 'SYNTHETIC' })); await cache.create(shared, JSON.stringify({ refreshToken: 'SYNTHETIC' }))
  await expect(cache.erasePodKey(shared, pod)).rejects.toThrow('shared'); await expect(cache.erasePodKey(key, randomUUID())).rejects.toThrow('foreign')
  available = false; await expect(cache.erasePodKey(key, pod)).rejects.toThrow('locked'); available = true
  await cache.erasePodKey(key, pod); await cache.erasePodKey(key, pod)
  await cache.withCache(shared, async () => {})
})

it('blocks pod execution on unverified OS and CPU combinations', () => {
  expect(() => assertPilotRuntime('darwin', 'arm64', '25.6.0')).not.toThrow()
  expect(() => assertPilotRuntime('darwin', 'x64', '25.6.0')).toThrow('verified')
  expect(() => assertPilotRuntime('darwin', 'arm64', '26.0.0')).toThrow('verified')
})
