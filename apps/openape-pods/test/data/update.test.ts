// @vitest-environment node
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { assertUpdate, verifyUpdate } from '../../src/main/update'
import type { DistributionManifest } from '../../src/main/update'
import { selectProfile, selectedProfile } from '../../src/main/profile'
import { assertExecutionSupported, executionSupport } from '../../src/main/support'
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
it('erases only the matching pod key, repeatedly', async () => {
  const base = await root()
  const cache = new CredentialCache(base)
  const pod = randomUUID(); const key = randomUUID(); const shared = randomUUID()
  await cache.create(key, JSON.stringify({ podId: pod, privateKey: 'SYNTHETIC' })); await cache.create(shared, JSON.stringify({ refreshToken: 'SYNTHETIC' }))
  await expect(cache.erasePodKey(shared, pod)).rejects.toThrow('shared'); await expect(cache.erasePodKey(key, randomUUID())).rejects.toThrow('foreign')
  await cache.erasePodKey(key, pod); await cache.erasePodKey(key, pod)
  await cache.withCache(shared, async () => {})
})

it('blocks pod execution on unverified OS, CPU and kernel combinations, including newer kernels', () => {
  expect(executionSupport('darwin', 'arm64', '25.6.0')).toMatchObject({ supported: true, reason: null, verified: expect.arrayContaining(['Darwin 25.6.0 (macOS 26.6.2)']) })
  expect(() => assertExecutionSupported(executionSupport('darwin', 'arm64', '25.6.0'))).not.toThrow()
  expect(executionSupport('darwin', 'arm64', '27.0.0')).toMatchObject({ supported: true, verified: expect.arrayContaining(['Darwin 27.0.0 (macOS 27.0.1)']) })
  for (const [platform, architecture, kernel] of [['darwin', 'x64', '25.6.0'], ['linux', 'arm64', '25.6.0'], ['darwin', 'arm64', '25.6.1'], ['darwin', 'arm64', '26.0.0'], ['darwin', 'x64', '27.0.0'], ['darwin', 'arm64', '27.0.1'], ['darwin', 'arm64', '27.1.0'], ['darwin', 'arm64', '28.0.0'], ['darwin', 'arm64', '99.0.0'], ['darwin', 'arm64', '']]) {
    const support = executionSupport(platform, architecture, kernel)
    expect(support.supported, `${platform} ${architecture} ${kernel}`).toBe(false)
    const incompatible = platform !== 'darwin' || architecture !== 'arm64'
    expect(support.compatibility).toBe(incompatible ? 'incompatible' : 'unverified')
    expect(() => assertExecutionSupported(support)).toThrow(incompatible ? `Pod execution is not available on ${platform} ${kernel} (${architecture})` : `Pod execution is blocked on ${platform} ${kernel} (${architecture})`)
  }
})
