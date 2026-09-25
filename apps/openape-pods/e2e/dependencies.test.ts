import { chmod, mkdtemp, realpath, mkdir, writeFile, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { packageDigest, packageFiles } from '../src/worker/dependencies/tree'
import { randomUUID } from 'node:crypto'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { ScriptCredentials } from '../src/worker/resources/script-credentials'
import { validateDraft } from '../src/worker/master/validation'
import { DependencyStore, removePackageTree } from '../src/worker/dependencies/store'

// The packaged editor flow is covered below the app: dependency search and
// selection in test/workspace/script-ui.test.ts, the preparation dialog in
// test/main/app.test.ts. What only a real process answers is this: a bare
// import resolves from the prepared, read-only library inside the sandbox.
it('managed dependencies: a bare import resolves from the prepared read-only library inside the sandbox', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-package-import-')))
  const store = new PodDatabase(root); const pod = store.createPod({ name: 'CSV review' })
  try {
    const packages = { dependencies: { 'sample-package': '1.0.0' } }
    const lock = { lockfileVersion: 3, packages: { '': packages, 'node_modules/sample-package': { version: '1.0.0', resolved: 'https://registry.npmjs.org/sample-package/-/sample-package-1.0.0.tgz', integrity: 'sha512-YQ==' } } }
    const stage = join(root, 'prepared'); await mkdir(join(stage, 'node_modules/sample-package'), { recursive: true })
    await writeFile(join(stage, 'package.json'), JSON.stringify(packages)); await writeFile(join(stage, 'package-lock.json'), JSON.stringify(lock))
    await writeFile(join(stage, 'node_modules/sample-package/package.json'), '{"name":"sample-package","version":"1.0.0","main":"index.cjs"}')
    await writeFile(join(stage, 'node_modules/sample-package/index.cjs'), 'module.exports=42')
    const files = await packageFiles(stage, true); const hash = packageDigest(files); const parent = join(root, 'dependencies', pod.id)
    await mkdir(parent, { recursive: true }); await chmod(stage, 0o700); await rename(stage, join(parent, hash)); await chmod(join(parent, hash), 0o500)
    store.db.prepare('INSERT INTO dependency_sets VALUES(?,?,?,?,?)').run(pod.id, hash, JSON.stringify(packages), JSON.stringify(lock), JSON.stringify(files))
    const resources = new ResourceRegistry(store, () => {})
    const runtime = { helper: resolve('dist/native/pods-helper'), executable: process.execPath, entry: resolve('dist/runtime/script-entry.mjs'), runtimeDirectories: [], environment: {}, binary: '', catalog: '', sdkHost: '', manifest: resolve('dist/vendor/manifest.json') }
    const draft = async (id: string, code: string) => {
      store.db.prepare('INSERT INTO script_drafts VALUES(?,?,?,?,?,?,NULL,NULL)').run(id, pod.id, 1, store.getPod(pod.id).bindingRevision, code, '[]')
      store.db.prepare('INSERT INTO draft_packages VALUES(?,?)').run(id, JSON.stringify(packages))
      return validateDraft(store, resources, runtime, id, 1, new AbortController().signal)
    }
    const result = await draft(randomUUID(), 'import answer from \'sample-package\'\nexport async function run(context) { if (answer !== 42) throw new Error(\'wrong library\'); return { status: \'completed\', summary: \'Library returned \' + answer, completedInputIds: context.input.eventIds, gapIds: [] } }\n')
    expect(new DependencyStore(store).scriptSet(pod.id, result.hash)).toBe(hash)
    // Counter-check: a package outside the prepared set does not resolve.
    await expect(draft(randomUUID(), 'import other from \'unprepared-package\'\nexport async function run() { return { status: \'completed\', summary: String(other), completedInputIds: [], gapIds: [] } }\n')).rejects.toThrow()
  }
  finally { store.close(); await removePackageTree(root) }
})

it('managed dependencies: changing a library requires a new validated script and retains assigned secrets', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-package-binding-')))
  const store = new PodDatabase(root); const pod = store.createPod({ name: 'Synthetic binding' })
  try {
    const resources = new ResourceRegistry(store, () => {}); resources.assignCredential(pod.id, 'api', randomUUID(), 0)
    const credentials = new ScriptCredentials(store, resources); const dependencies = new DependencyStore(store)
    const draftId = randomUUID(); let first = ''
    const runtime = { helper: resolve('dist/native/pods-helper'), executable: process.execPath, entry: resolve('dist/runtime/script-entry.mjs'), runtimeDirectories: [], environment: {}, binary: '', catalog: '', sdkHost: '', manifest: resolve('dist/vendor/manifest.json') }
    for (const revision of [1, 2]) {
      const version = `1.0.${revision}`; const packages = { dependencies: { sample: version } }
      const lock = { lockfileVersion: 3, packages: { '': packages, 'node_modules/sample': { version, resolved: `https://registry.npmjs.org/sample/-/sample-${version}.tgz`, integrity: 'sha512-YQ==' } } }
      const stage = join(root, `stage-${revision}`); await mkdir(join(stage, 'node_modules/sample'), { recursive: true })
      await writeFile(join(stage, 'package.json'), JSON.stringify(packages)); await writeFile(join(stage, 'package-lock.json'), JSON.stringify(lock))
      await writeFile(join(stage, 'node_modules/sample/package.json'), JSON.stringify({ name: 'sample', version }))
      const files = await packageFiles(stage, true); const hash = packageDigest(files); const parent = join(root, 'dependencies', pod.id)
      await mkdir(parent, { recursive: true }); await chmod(stage, 0o700); await rename(stage, join(parent, hash)); await chmod(join(parent, hash), 0o500)
      store.db.prepare('INSERT INTO dependency_sets VALUES(?,?,?,?,?)').run(pod.id, hash, JSON.stringify(packages), JSON.stringify(lock), JSON.stringify(files))
      const code = 'export async function run(){return {status:"completed",summary:"Synthetic binding",completedInputIds:[],gapIds:[]}}'
      store.db.prepare('INSERT INTO script_drafts VALUES(?,?,?,?,?,?,NULL,NULL) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,script_hash=NULL,validation=NULL').run(draftId, pod.id, revision, store.getPod(pod.id).bindingRevision, code, '["credential.api"]')
      store.db.prepare('INSERT INTO draft_packages VALUES(?,?) ON CONFLICT(draft_id) DO UPDATE SET manifest=excluded.manifest').run(draftId, JSON.stringify(packages))
      const result = await validateDraft(store, resources, runtime, draftId, revision, new AbortController().signal)
      expect(dependencies.scriptSet(pod.id, result.hash)).toBe(hash)
      if (revision === 1) { credentials.approve(pod.id, result.hash, pod.revision, resources.epoch(pod.id)); first = result.hash; expect(credentials.approved(pod.id, first)).toBe(true) }
      else { expect(result.hash).not.toBe(first); expect(credentials.approved(pod.id, result.hash)).toBe(true) }
    }
  }
  finally { store.close(); await removePackageTree(root) }
})
