import { build } from 'tsup'
import { pathToFileURL } from 'node:url'
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { sha256 } from './distribution.mjs'
import { failOnKeychainDialog } from '../e2e/fixtures/keychain.ts'

const signedLocal = process.argv.includes('--signed-local')
const publicRelease = process.argv.includes('--signed')
if ((signedLocal && publicRelease) || process.argv.slice(2).some(argument => !['--signed-local', '--signed'].includes(argument))) throw new Error('Unsupported verification option')
const version = JSON.parse(await readFile('package.json', 'utf8')).version
const image = resolve(`release/distribution/OpenApe-Pods-${version}-arm64-${signedLocal ? 'signed-local' : publicRelease ? 'signed' : 'unsigned'}.dmg`)
const checksums = await readFile('release/distribution/SHA256SUMS', 'utf8')
assert.ok(checksums.trim().split('\n').includes(`${sha256(image)}  ${image.split('/').at(-1)}`))
const root = await realpath(await mkdtemp(join(tmpdir(), 'Pods DMG Müller '))); const mount = join(root, 'volume'); const profile = join(root, 'profile')
await mkdir(mount); await mkdir(profile, { mode: 0o700 })
let attached = false; let app; let identity
try {
  execFileSync('/usr/bin/hdiutil', ['verify', image], { stdio: 'pipe' })
  execFileSync('/usr/bin/hdiutil', ['attach', image, '-readonly', '-nobrowse', '-mountpoint', mount], { stdio: 'pipe' }); attached = true
  const bundle = join(mount, 'OpenApe Pods.app')
  if (signedLocal || publicRelease) {
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'pipe' })
    execFileSync('/usr/bin/xcrun', ['stapler', 'validate', bundle], { stdio: 'pipe' })
    execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', bundle], { stdio: 'pipe' })
  }
  const icon = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIconFile', join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }).trim()
  assert.equal(icon, 'icon.icns')
  assert.equal(sha256(join(bundle, 'Contents/Resources', icon)), sha256('build/openape-pods.icns'))
  const manifest = JSON.parse(await readFile(join(bundle, 'Contents/Resources/pods-distribution.json'), 'utf8'))
  assert.equal(manifest.releaseReady, publicRelease); assert.equal(manifest.version, version)
  const bom = JSON.parse(await readFile(join(bundle, 'Contents/Resources/bom.json'), 'utf8')); assert.ok(bom.packages.length > 5); assert.ok(bom.blockers.length)
  app = await electron.launch({ executablePath: join(bundle, 'Contents/MacOS/OpenApe Pods'), env: { HOME: profile, TMPDIR: root, PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: profile, NODE_ENV: 'test' } })
  failOnKeychainDialog(app)
  const page = await app.firstWindow()
  // waitForFunction does not await an async predicate (a pending promise is truthy), so poll the actual worker state.
  const deadline = Date.now() + 60000
  for (let state = ''; state !== 'ready'; await new Promise(resolve => setTimeout(resolve, 250))) {
    state = await page.evaluate(async () => (await window.pods.getStatus()).worker.state)
    if (!['starting', 'ready'].includes(state)) throw new Error(`Worker state ${state} during startup`)
    if (Date.now() > deadline) throw new Error(`Worker still ${state} after 60 s`)
  }
  await page.evaluate(() => window.pods.workspace({ type: 'create', name: 'DMG acceptance' }))
  await build({ entry: { identity: resolve('e2e/fixtures/shell-identity.ts') }, outDir: root, format: ['esm'], platform: 'node', target: 'node24', silent: true, removeNodeProtocol: false, outExtension: () => ({ js: '.mjs' }) })
  const { fixtureShellIdentity } = await import(pathToFileURL(join(root, 'identity.mjs')).href)
  identity = await fixtureShellIdentity(profile); await identity.encrypt(app, true)
  // The Automations tab lists the Pod; its detail page opens the Pod editor.
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await page.getByRole('row', { name: /DMG acceptance/ }).click()
  await page.getByRole('button', { name: 'Open details', exact: true }).click()
  await page.getByRole('tab', { name: 'History', exact: true }).click(); await page.evaluate(async () => { const pod = (await window.pods.workspace({ type: 'list' })).pods[0]; await window.pods.runs({ type: 'installExample', podId: pod.id, variant: 'deterministic' }) }); await page.getByRole('button', { name: 'Run now', exact: true }).click()
  await page.getByText('Local example completed (1)', { exact: true }).waitFor()
  await page.getByTestId('back-to-automations').click(); await page.getByRole('button', { name: 'OpenApe account', exact: true }).click(); await page.locator('summary').filter({ hasText: 'Data & backups' }).click(); await page.getByRole('heading', { name: 'Data & backups', exact: true }).waitFor()
  await mkdir('.artifacts', { recursive: true }); await page.screenshot({ path: '.artifacts/data-dmg.png' })
  console.log(JSON.stringify({ image, sha256: sha256(image), npmPackages: bom.packages.length, result: 'passed', signed: signedLocal || publicRelease, releaseReady: manifest.releaseReady, actualProvider: false }))
}
finally {
  if (app) await app.close()
  await identity?.close()
  if (attached) execFileSync('/usr/bin/hdiutil', ['detach', mount], { stdio: 'pipe' })
  await rm(root, { recursive: true, force: true })
}
