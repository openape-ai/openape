import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

export const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')
function packageFile(name, parent) {
  for (const directory of createRequire(parent).resolve.paths(name) ?? []) {
    const file = join(directory, name, 'package.json')
    if (existsSync(file)) return file
  }
  throw new Error(`Package metadata not found: ${name}`)
}
export function inventory() {
  const packages = new Map(); const notices = []
  function visit(name, parent) {
    const file = realpathSync(packageFile(name, parent)); const value = JSON.parse(readFileSync(file, 'utf8')); const key = `${value.name}@${value.version}`
    if (packages.has(key)) return
    const directory = dirname(file)
    const licenses = readdirSync(directory).filter(name => /^(?:license|licence|notice|copying)(?:\.|$)/i.test(name) && statSync(join(directory, name)).isFile()).map(name => ({ name, sha256: sha256(join(directory, name)) }))
    packages.set(key, { name: value.name, version: value.version, declaredLicense: value.license ?? null, licenses })
    for (const license of licenses) notices.push(`\n===== ${key} / ${license.name} =====\n${readFileSync(join(directory, license.name), 'utf8')}`)
    for (const dependency of Object.keys(value.dependencies ?? {})) visit(dependency, file)
  }
  const parent = resolve('package.json')
  for (const name of ['vue', '@openai/codex-sdk', '@openai/codex', '@openape/apes', 'pdfjs-dist', 'html-to-text', 'fflate']) visit(name, parent)
  const electron = dirname(packageFile('electron', parent))
  for (const name of ['LICENSE', 'LICENSES.chromium.html']) notices.push(`\n===== Electron 40.9.3 / ${name} =====\n${readFileSync(join(electron, 'dist', name), 'utf8')}`)
  const o365 = JSON.parse(readFileSync('dist/vendor/o365-manifest.json', 'utf8'))
  const codex = JSON.parse(readFileSync('dist/vendor/manifest.json', 'utf8'))
  const blockers = [
    'o365 source revision has no upstream LICENSE file; obtain authoritative text and redistribution review',
    'Review the pinned Codex native Rust dependency notices; npm license metadata is not a complete native dependency inventory',
    'Review Go module license notices and public CA bundle provenance for redistribution',
    ...[...packages.values()].filter(item => !item.licenses.length).map(item => `No packaged license text: ${item.name}@${item.version}`),
  ]
  return { bom: { format: 'openape-pods-bom', version: 1, dependencyLockHash: sha256('../../pnpm-lock.yaml'), platform: process.platform, architecture: process.arch, electron: '40.9.3', nativeHelperSha256: sha256('dist/native/pods-helper'), packages: [...packages.values()], o365, codex, goBuild: execFileSync('go', ['version', '-m', 'dist/vendor/o365-cli'], { encoding: 'utf8' }), scope: 'Conservative runtime npm dependency closure, Electron/Chromium notices, pinned native origins and Go build metadata. Native transitive license review remains a release gate.', blockers }, notices: notices.join('\n') }
}
export function writeDistribution(releaseReady = false, review = null) {
  const { bom, notices } = inventory(); const version = JSON.parse(readFileSync('package.json', 'utf8')).version
  const schema = Number(/export const schemaVersion = (\d+)/.exec(readFileSync('src/worker/storage/database.ts', 'utf8'))?.[1])
  if (!Number.isSafeInteger(schema)) throw new Error('Cannot determine database schema')
  mkdirSync('dist/distribution', { recursive: true })
  if (review) { bom.licenseReview = review.gates.licenses; bom.supplementalNoticesHash = review.supplementalNoticesSha256 }
  writeFileSync('dist/distribution/bom.json', JSON.stringify(bom, null, 2)); writeFileSync('dist/distribution/THIRD-PARTY-NOTICES.txt', notices + (review ? `\n===== Reviewed native and supplemental notices =====\n${readFileSync('runtime-sources/licenses/REVIEWED-NOTICES.txt', 'utf8')}` : ''))
  writeFileSync('dist/distribution/pods-distribution.json', JSON.stringify({ format: 'openape-pods-distribution', version, platform: 'darwin', architecture: process.arch, schema: { minimum: 1, current: schema }, releaseReady, bomHash: sha256('dist/distribution/bom.json') }, null, 2))
  return bom
}
export function requireReleaseReview(candidate = false) {
  const review = JSON.parse(readFileSync(process.env.OPENAPE_PODS_RELEASE_REVIEW ?? 'runtime-sources/distribution-review.json', 'utf8'))
  if (review.dependencyLockHash !== sha256('../../pnpm-lock.yaml') || review.sourceRevision !== execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()) throw new Error('Signed distribution requires review bound to the exact source and dependency lock')
  const build = JSON.parse(readFileSync('dist/build-inputs.json', 'utf8'))
  if (!build.clean || build.sourceRevision !== review.sourceRevision || build.dependencyLockHash !== review.dependencyLockHash || execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Signed distribution requires a fresh build of a clean reviewed source')
  const gates = candidate ? ['licenses'] : ['licenses', 'signedBoundaries', 'cleanMachine', 'realProvider', 'realTenantRefresh', 'physicalSleepWake', 'osCpuMatrix']
  for (const gate of gates) {
    if (review.gates?.[gate]?.status !== 'passed' || typeof review.gates[gate].evidence !== 'string' || !review.gates[gate].evidence.startsWith('https://')) throw new Error(`Signed distribution gate is pending: ${gate}`)
  }
  if (review.supplementalNoticesSha256 !== sha256('runtime-sources/licenses/REVIEWED-NOTICES.txt')) throw new Error('Reviewed native license notices are missing or changed')
  return review
}
