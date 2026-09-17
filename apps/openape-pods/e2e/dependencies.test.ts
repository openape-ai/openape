import { fixtureShellIdentity } from './fixtures/shell-identity'
import { _electron as electron } from 'playwright'
import { chmod, mkdtemp, realpath, mkdir, writeFile, rename } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { fixtureDirectory } from '../src/main/fixture'
import { packageDigest, packageFiles } from '../src/worker/dependencies/tree'
import { randomUUID } from 'node:crypto'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { ScriptCredentials } from '../src/worker/resources/script-credentials'
import { validateDraft } from '../src/worker/master/validation'
import { DependencyStore, removePackageTree } from '../src/worker/dependencies/store'

it('managed dependencies: packaged editor saves, prepares, validates and runs an immutable local library', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-packages-ui-'))); fixtureDirectory(root)
  const store = new PodDatabase(root); const pod = store.createPod({ name: 'CSV review' })
  const packages = { dependencies: { 'sample-package': '1.0.0' } }
  const lock = { lockfileVersion: 3, packages: { '': packages, 'node_modules/sample-package': { version: '1.0.0', resolved: 'https://registry.npmjs.org/sample-package/-/sample-package-1.0.0.tgz', integrity: 'sha512-YQ==' } } }
  const stage = join(root, 'prepared'); await mkdir(join(stage, 'node_modules/sample-package'), { recursive: true })
  await writeFile(join(stage, 'package.json'), JSON.stringify(packages)); await writeFile(join(stage, 'package-lock.json'), JSON.stringify(lock))
  await writeFile(join(stage, 'node_modules/sample-package/package.json'), '{"name":"sample-package","version":"1.0.0","main":"index.cjs"}')
  await writeFile(join(stage, 'node_modules/sample-package/index.cjs'), 'module.exports=42')
  const files = await packageFiles(stage, true); const hash = packageDigest(files); const parent = join(root, 'dependencies', pod.id)
  await mkdir(parent, { recursive: true }); await chmod(stage, 0o700); await rename(stage, join(parent, hash)); await chmod(join(parent, hash), 0o500)
  store.db.prepare('INSERT INTO dependency_sets VALUES(?,?,?,?,?)').run(pod.id, hash, JSON.stringify(packages), JSON.stringify(lock), JSON.stringify(files)); store.close()
  const identity = await fixtureShellIdentity(root)
  const app = await electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), args: [], cwd: resolve('.'), env: { HOME: homedir(), TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } })
  try {
    await identity.encrypt(app, true)
    const page = await app.firstWindow(); await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    await page.getByRole('tab', { name: 'Script', exact: true }).click()
    await page.getByLabel('Script source').fill('import answer from \'sample-package\';\n\nexport async function run(context) {\n  return { status: \'completed\', summary: \'Library returned \'+answer, completedInputIds: context.input.eventIds, gapIds: [] }\n}\n')
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('pods:packages')
      ipcMain.handle('pods:packages', () => [{ name: 'sample-package', version: '1.0.0', description: 'Synthetic library for the packaged UI check' }])
    })
    await page.getByRole('button', { name: 'Add dependency', exact: true }).click()
    await page.getByLabel('Search npm or paste an npm package URL').fill('sample-package')
    await page.getByRole('button', { name: 'Search npm', exact: true }).click()
    await page.locator('.package-result').click()
    await page.locator('.package-picker').scrollIntoViewIfNeeded()
    await mkdir(resolve('.artifacts'), { recursive: true })
    await page.screenshot({ path: resolve('.artifacts/dependency-search-en.png'), fullPage: true })
    await page.locator('.package-choice').getByRole('button', { name: 'Add dependency', exact: true }).click()
    await page.getByRole('button', { name: 'Save script', exact: true }).click()
    await expect.poll(() => page.getByText('Dependencies prepared', { exact: true }).isVisible()).toBe(true)
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
    await page.getByRole('button', { name: 'Prepare dependencies', exact: true }).click()
    await expect.poll(() => page.getByRole('button', { name: 'Prepare dependencies', exact: true }).isEnabled()).toBe(true)
    expect((await page.evaluate(podId => window.pods.scripts({ type: 'list', podId }), pod.id)).source?.validated).toBe(false)
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
    await page.getByRole('button', { name: 'Prepare dependencies', exact: true }).click()
    await expect.poll(() => page.getByRole('button', { name: 'Prepare dependencies', exact: true }).isEnabled()).toBe(true)
    await mkdir(resolve('.artifacts'), { recursive: true }); await page.locator('.script-packages').scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve('.artifacts/managed-dependencies-en.png'), fullPage: true })
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), pod.id)).runs[0]?.state, { timeout: 15000 }).toBe('completed')
    const view = await page.evaluate(podId => window.pods.scripts({ type: 'list', podId }), pod.id)
    expect(view.source?.packages).toEqual(packages); expect(view.source?.validated).toBe(true)
    await page.getByRole('tab', { name: 'Permissions', exact: true }).click()
    const gap = await page.locator('.http-heading').evaluate((node) => { const previous = node.previousElementSibling!; return node.getBoundingClientRect().top - previous.getBoundingClientRect().bottom })
    expect(gap).toBeGreaterThanOrEqual(34)
    await page.locator('.program-permissions').scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve('.artifacts/managed-dependencies-permissions-en.png'), fullPage: true })
    await page.evaluate(() => window.pods.language({ type: 'set', language: 'de' })); await page.reload()
    await page.getByRole('tab', { name: 'Skript', exact: true }).click()
    await page.locator('.script-packages').scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve('.artifacts/managed-dependencies-de.png'), fullPage: true })
  }
  finally { await app.close(); await identity.close(); await removePackageTree(root) }
})

it('managed dependencies: changing a library requires a new validated script and credential approval', async () => {
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
      else { expect(result.hash).not.toBe(first); expect(credentials.approved(pod.id, result.hash)).toBe(false) }
    }
  }
  finally { store.close(); await removePackageTree(root) }
})
