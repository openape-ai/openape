// @vitest-environment node
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { mkdir, mkdtemp, readFile, realpath, rename, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { validateImportedLock, verifyImportedTree } from '../../src/worker/dependencies/imported-lock'
import { installPackages } from '../../src/worker/dependencies/install'
import { DependencyStore, removePackageTree } from '../../src/worker/dependencies/store'
import { launchSandbox } from '../../src/worker/runtime/sandbox'
import { startMailProxy } from '../../src/main/mail/proxy'
import { PodDatabase } from '../../src/worker/storage/database'
import { packageDigest, packageFiles } from '../../src/worker/dependencies/tree'
import type { ScriptRuntime } from '../../src/worker/runs/runner'

vi.mock('../../src/worker/runtime/sandbox', () => ({ launchSandbox: vi.fn() }))
vi.mock('../../src/main/mail/proxy', () => ({ startMailProxy: vi.fn() }))
const npmRoot = dirname(createRequire(import.meta.url).resolve('npm/package.json'))
const manifest = { dependencies: { fixture: '1.0.0' } }
const integrity = `sha512-${Buffer.alloc(64, 1).toString('base64')}`
function packageEntry(name: string, version: string) { return { version, resolved: `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`, integrity } }
function fixture() {
  return { lockfileVersion: 3, requires: true, packages: {
    '': manifest,
    'node_modules/fixture': { ...packageEntry('fixture', '1.0.0'), dependencies: { child: '^2.0.0' } },
    'node_modules/child': packageEntry('child', '2.1.0'),
  } }
}
const roots: string[] = []
async function runtimeFixture(): Promise<ScriptRuntime> {
  const root = await mkdtemp(join(tmpdir(), 'pods-imported-runtime-')); roots.push(root)
  await mkdir(join(root, 'vendor')); await symlink(npmRoot, join(root, 'vendor/npm'))
  return { entry: join(root, 'runtime/script-entry.mjs'), executable: '/synthetic-node', helper: '/synthetic-helper', runtimeDirectories: [] } as unknown as ScriptRuntime
}
afterEach(async () => { vi.resetAllMocks(); for (const root of roots.splice(0)) await removePackageTree(root) })

it('retains a complete pinned transitive tree without resolving a replacement', () => {
  const lock = fixture()
  expect(JSON.parse(validateImportedLock(lock, manifest, npmRoot))).toEqual(lock)
  const reordered = { ...lock, packages: Object.fromEntries(Object.entries(lock.packages).reverse()) }
  expect(validateImportedLock(reordered, manifest, npmRoot)).toBe(validateImportedLock(lock, manifest, npmRoot))
})
it('rejects substituted package versions, paths, tarballs and integrity', () => {
  for (const patch of [{ version: '3.0.0' }, { resolved: 'https://evil.example/child.tgz' }, { integrity: 'sha512-YQ==' }, { name: 'another' }, { hasInstallScript: true }, { link: true }, { scripts: { install: 'no' } }]) {
    const lock = fixture(); Object.assign(lock.packages['node_modules/child'], patch)
    expect(() => validateImportedLock(lock, manifest, npmRoot)).toThrow()
  }
  const mismatch = fixture(); mismatch.packages['node_modules/child'] = packageEntry('child', '3.0.0')
  expect(() => validateImportedLock(mismatch, manifest, npmRoot)).toThrow('does not satisfy')
  expect(() => validateImportedLock(fixture(), { dependencies: { fixture: '2.0.0' } }, npmRoot)).toThrow('does not match')
})
it('rejects missing, unreachable and externally sourced transitives', () => {
  const lock = fixture()
  const missing = { ...lock, packages: { '': manifest, 'node_modules/fixture': lock.packages['node_modules/fixture'] } }
  expect(() => validateImportedLock(missing, manifest, npmRoot)).toThrow('unresolved dependency')
  const extra = { ...lock, packages: { ...lock.packages, 'node_modules/unrelated': packageEntry('unrelated', '1.0.0') } }
  expect(() => validateImportedLock(extra, manifest, npmRoot)).toThrow('unreachable')
  lock.packages['node_modules/fixture'].dependencies.child = 'file:/private/source'
  expect(() => validateImportedLock(lock, manifest, npmRoot)).toThrow('registry version ranges')
})
it('checks peer constraints separately from normal dependencies', () => {
  const lock = fixture()
  Object.assign(lock.packages['node_modules/fixture'], { peerDependencies: { child: '^3.0.0' } })
  expect(() => validateImportedLock(lock, manifest, npmRoot)).toThrow('does not satisfy')
})
it('rejects invalid imported locks before creating a proxy or sandbox', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pods-imported-lock-')); roots.push(root)
  const runtime = { entry: join(root, 'runtime/entry.mjs') } as ScriptRuntime
  await expect(installPackages(runtime, root, manifest, new AbortController().signal, () => {}, '{"lockfileVersion":2,"packages":{}}')).rejects.toThrow('version 3')
  expect(startMailProxy).not.toHaveBeenCalled(); expect(launchSandbox).not.toHaveBeenCalled()
  await expect(readFile(join(root, 'project/package.json'))).rejects.toThrow('ENOENT')
})
it('runs npm ci alone with the imported lock and existing sandbox restrictions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pods-imported-lock-')); roots.push(root)
  const runtime = await runtimeFixture()
  const close = vi.fn(async () => {})
  vi.mocked(startMailProxy).mockResolvedValue({ port: 12345, environment: { HTTPS_PROXY: 'http://fixture:synthetic@127.0.0.1:12345' }, close } as never)
  vi.mocked(launchSandbox).mockImplementation(async (_helper, _stage, _policy, args) => {
    expect(args[1]).toBe('ci')
    expect(args).toContain('--ignore-scripts'); expect(args).toContain('--bin-links=false')
    expect(JSON.parse(await readFile(join(root, 'project/package-lock.json'), 'utf8'))).toEqual(fixture())
    for (const [name, version] of [['fixture', '1.0.0'], ['child', '2.1.0']]) {
      const directory = join(root, 'project/node_modules', name!)
      await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version, ...(name === 'fixture' ? { dependencies: { child: '^2.0.0' } } : {}) }))
    }
    return { processId: Promise.resolve(1), completed: Promise.resolve(0), cancel: vi.fn(), stdout: new PassThrough(), stderr: new PassThrough() } as never
  })
  expect(await installPackages(runtime, root, manifest, new AbortController().signal, () => {}, JSON.stringify(fixture()))).toBe(join(root, 'project'))
  expect(launchSandbox).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1)
})

it('does not trust an optional package flag to omit a required transitive', async () => {
  const lock = fixture(); Object.assign(lock.packages['node_modules/child'], { optional: true, os: ['not-this-system'] })
  const root = await mkdtemp(join(tmpdir(), 'pods-imported-tree-')); roots.push(root)
  await mkdir(join(root, 'node_modules/fixture'), { recursive: true })
  await writeFile(join(root, 'node_modules/fixture/package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { child: '^2.0.0' } }))
  const canonical = validateImportedLock(lock, manifest, npmRoot)
  await expect(verifyImportedTree(root, canonical, manifest, npmRoot, new AbortController().signal)).rejects.toThrow('missing a required package')
})

it('accepts scoped and nested pinned packages with supported npm metadata', () => {
  const lock = fixture()
  const nested = { ...lock, packages: { ...lock.packages,
    'node_modules/fixture': { ...lock.packages['node_modules/fixture'], dependencies: { child: '^2.0.0', '@scope/library': '1.0.0' }, peerDependenciesMeta: { unused: { optional: true } } },
    'node_modules/fixture/node_modules/@scope/library': { ...packageEntry('@scope/library', '1.0.0'), peer: true, deprecated: 'Fixture metadata', license: 'MIT', engines: { node: '>=20' }, bin: { fixture: 'bin/run.js' }, funding: { type: 'individual', url: 'https://example.com/funding' } },
  } }
  expect(JSON.parse(validateImportedLock(nested, manifest, npmRoot))).toEqual(nested)
  expect(validateImportedLock({ lockfileVersion: 3, packages: { '': {} } }, { dependencies: {} }, npmRoot)).toBeTruthy()
})
it('reuses only the exact imported lock and leaves an existing dependency set intact on mismatch', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-imported-reuse-'))); roots.push(root)
  const store = new PodDatabase(join(root, 'profile'))
  try {
    const pod = store.createPod({ name: 'Imported dependency fixture' })
    const stage = join(root, 'stage'); await mkdir(stage)
    await writeFile(join(stage, 'package.json'), JSON.stringify(manifest))
    await writeFile(join(stage, 'package-lock.json'), JSON.stringify(fixture()))
    for (const [name, version] of [['fixture', '1.0.0'], ['child', '2.1.0']]) {
      const path = join(stage, 'node_modules', name!); await mkdir(path, { recursive: true })
      await writeFile(join(path, 'package.json'), JSON.stringify({ name, version, ...(name === 'fixture' ? { dependencies: { child: '^2.0.0' } } : {}) }))
    }
    const files = await packageFiles(stage); const hash = packageDigest(files)
    const destination = join(store.root, 'dependencies', pod.id, hash)
    await mkdir(join(store.root, 'dependencies', pod.id), { recursive: true })
    await rename(stage, destination)
    store.db.prepare('INSERT INTO dependency_sets VALUES(?,?,?,?,?)').run(pod.id, hash, JSON.stringify(manifest), JSON.stringify(fixture()), JSON.stringify(files))
    const dependencies = new DependencyStore(store)
    const runtime = await runtimeFixture()
    expect(await dependencies.prepare(runtime, pod.id, manifest, new AbortController().signal, () => {}, JSON.stringify(fixture()))).toBe(hash)
    const different = fixture(); different.packages['node_modules/child'] = packageEntry('child', '2.2.0')
    await expect(dependencies.prepare(runtime, pod.id, manifest, new AbortController().signal, () => {}, JSON.stringify(different))).rejects.toThrow('different dependency lock')
    expect(await dependencies.verify(pod.id, hash)).toBe(await realpath(destination))
    expect(launchSandbox).not.toHaveBeenCalled(); expect(startMailProxy).not.toHaveBeenCalled()
  }
  finally { store.close() }
})

it('rejects omitted or falsified lock edges against the installed package manifest', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-imported-edges-'))); roots.push(root)
  await mkdir(join(root, 'node_modules/fixture'), { recursive: true })
  await writeFile(join(root, 'node_modules/fixture/package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { child: '^2.0.0' } }))
  const missing = { lockfileVersion: 3, packages: { '': manifest, 'node_modules/fixture': packageEntry('fixture', '1.0.0') } }
  await expect(verifyImportedTree(root, validateImportedLock(missing, manifest, npmRoot), manifest, npmRoot, new AbortController().signal)).rejects.toThrow('requirements differ')
  const altered = fixture(); altered.packages['node_modules/fixture'].dependencies.child = '^1.0.0'; altered.packages['node_modules/child'] = packageEntry('child', '1.0.0')
  await mkdir(join(root, 'node_modules/child')); await writeFile(join(root, 'node_modules/child/package.json'), JSON.stringify({ name: 'child', version: '1.0.0' }))
  await expect(verifyImportedTree(root, validateImportedLock(altered, manifest, npmRoot), manifest, npmRoot, new AbortController().signal)).rejects.toThrow('requirements differ')
})
it('permits absent optional packages and optional peers without losing required edges', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-imported-optional-'))); roots.push(root)
  const declarations = { optionalDependencies: { child: '^2.0.0' }, peerDependencies: { peer: '^1.0.0' }, peerDependenciesMeta: { peer: { optional: true } } }
  const lock = { lockfileVersion: 3, packages: { '': manifest, 'node_modules/fixture': { ...packageEntry('fixture', '1.0.0'), ...declarations }, 'node_modules/child': { ...packageEntry('child', '2.1.0'), optional: true } } }
  await mkdir(join(root, 'node_modules/fixture'), { recursive: true })
  await writeFile(join(root, 'node_modules/fixture/package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', ...declarations }))
  await expect(verifyImportedTree(root, validateImportedLock(lock, manifest, npmRoot), manifest, npmRoot, new AbortController().signal)).resolves.toBeUndefined()
})
it('rejects unlisted nested packages that could shadow a pinned dependency', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-imported-bundled-'))); roots.push(root)
  await mkdir(join(root, 'node_modules/fixture/node_modules/ghost'), { recursive: true })
  await writeFile(join(root, 'node_modules/fixture/package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }))
  await writeFile(join(root, 'node_modules/fixture/node_modules/ghost/package.json'), JSON.stringify({ name: 'ghost', version: '1.0.0' }))
  const lock = { lockfileVersion: 3, packages: { '': manifest, 'node_modules/fixture': packageEntry('fixture', '1.0.0') } }
  await expect(verifyImportedTree(root, validateImportedLock(lock, manifest, npmRoot), manifest, npmRoot, new AbortController().signal)).rejects.toThrow('unlisted package')
})
it('requires mandatory children when an optional parent is actually installed', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-imported-optional-parent-'))); roots.push(root)
  const fixtureEdges = { optionalDependencies: { child: '^2.0.0' } }; const childEdges = { dependencies: { grandchild: '^1.0.0' } }
  const lock = { lockfileVersion: 3, packages: { '': manifest, 'node_modules/fixture': { ...packageEntry('fixture', '1.0.0'), ...fixtureEdges }, 'node_modules/child': { ...packageEntry('child', '2.1.0'), ...childEdges, optional: true }, 'node_modules/grandchild': { ...packageEntry('grandchild', '1.0.0'), optional: true } } }
  for (const [name, version, edges] of [['fixture', '1.0.0', fixtureEdges], ['child', '2.1.0', childEdges]] as const) {
    const directory = join(root, 'node_modules', name); await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version, ...edges }))
  }
  await expect(verifyImportedTree(root, validateImportedLock(lock, manifest, npmRoot), manifest, npmRoot, new AbortController().signal)).rejects.toThrow('missing a required package')
})
