import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { sha256 } from './distribution.mjs'

const version = JSON.parse(await readFile('package.json', 'utf8')).version
const image = resolve(`release/distribution/OpenApe-Pods-${version}-arm64-unsigned.dmg`)
const checksums = await readFile('release/distribution/SHA256SUMS', 'utf8')
assert.equal(checksums.trim(), `${sha256(image)}  ${image.split('/').at(-1)}`)
const root = await realpath(await mkdtemp(join(tmpdir(), 'Pods DMG Müller '))); const mount = join(root, 'volume'); const profile = join(root, 'profile')
await mkdir(mount); await mkdir(profile, { mode: 0o700 })
let attached = false; let app
try {
  execFileSync('/usr/bin/hdiutil', ['verify', image], { stdio: 'pipe' })
  execFileSync('/usr/bin/hdiutil', ['attach', image, '-readonly', '-nobrowse', '-mountpoint', mount], { stdio: 'pipe' }); attached = true
  const bundle = join(mount, 'OpenApe Pods.app')
  const icon = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIconFile', join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }).trim()
  assert.equal(icon, 'icon.icns')
  assert.equal(sha256(join(bundle, 'Contents/Resources', icon)), sha256('build/openape-pods.icns'))
  const manifest = JSON.parse(await readFile(join(bundle, 'Contents/Resources/pods-distribution.json'), 'utf8'))
  assert.equal(manifest.releaseReady, false); assert.equal(manifest.version, version)
  const bom = JSON.parse(await readFile(join(bundle, 'Contents/Resources/bom.json'), 'utf8')); assert.ok(bom.packages.length > 5); assert.ok(bom.blockers.length)
  app = await electron.launch({ executablePath: join(bundle, 'Contents/MacOS/OpenApe Pods'), env: { HOME: profile, TMPDIR: root, PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: profile, NODE_ENV: 'test' } })
  const page = await app.firstWindow()
  await page.getByRole('status').filter({ hasText: 'Ready' }).waitFor()
  await page.evaluate(() => window.pods.workspace({ type: 'create', name: 'DMG acceptance', assignment: 'Run the synthetic bundled example only.' }))
  await page.getByRole('tab', { name: 'Runs', exact: true }).click(); await page.getByRole('button', { name: 'Use local example', exact: true }).click(); await page.getByRole('button', { name: 'Start run', exact: true }).click()
  await page.getByRole('button', { name: 'Local example completed (1)', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Data & backups', exact: true }).click(); await page.getByRole('heading', { name: 'Data & backups', exact: true }).waitFor()
  await mkdir('.artifacts', { recursive: true }); await page.screenshot({ path: '.artifacts/data-dmg.png' })
  console.log(JSON.stringify({ image, sha256: sha256(image), npmPackages: bom.packages.length, result: 'passed', signed: false, actualProvider: false }))
}
finally {
  if (app) await app.close()
  if (attached) execFileSync('/usr/bin/hdiutil', ['detach', mount], { stdio: 'pipe' })
  await rm(root, { recursive: true, force: true })
}
