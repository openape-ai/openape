import { build, Platform, Arch } from 'electron-builder'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { requireReleaseReview, sha256, writeDistribution } from './distribution.mjs'

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('The verified Pods package currently requires macOS arm64')
const distribution = process.argv.includes('--distribution'); const candidate = process.argv.includes('--signed-candidate'); const signed = process.argv.includes('--signed') || candidate
if (process.argv.slice(2).some(value => !['--distribution', '--signed', '--signed-candidate'].includes(value)) || (signed && !distribution) || (candidate && process.argv.includes('--signed'))) throw new Error('Unsupported package option')
const identity = process.env.OPENAPE_PODS_SIGNING_IDENTITY
let review = null
if (signed) {
  review = requireReleaseReview(candidate)
  if (!identity?.startsWith('Developer ID Application: ') || !process.env.OPENAPE_PODS_NOTARY_PROFILE) throw new Error('Explicit Developer ID and notary keychain profile are required')
  for (const path of ['dist/native/pods-helper', 'dist/vendor/codex', 'dist/vendor/o365-cli']) execFileSync('/usr/bin/codesign', ['--force', '--timestamp', '--options', 'runtime', '--sign', identity, path], { stdio: 'inherit' })
  for (const [manifest, binary] of [['manifest.json', 'codex'], ['o365-manifest.json', 'o365-cli']]) {
    const path = join('dist/vendor', manifest); const value = JSON.parse(readFileSync(path, 'utf8')); value.binaryHash = sha256(join('dist/vendor', binary)); writeFileSync(path, JSON.stringify(value, null, 2))
  }
}
if (distribution) writeDistribution(signed && !candidate, review)
const output = distribution ? 'release/distribution' : 'release'
const productName = distribution ? 'OpenApe Pods' : 'OpenApe Pods Fixture'
const artifacts = await build({ targets: Platform.MAC.createTarget(distribution ? ['dir', 'dmg'] : ['dir'], Arch.arm64), publish: 'never', config: {
  publish: [], forceCodeSigning: signed, appId: distribution ? 'ai.openape.pods' : 'ai.openape.pods.fixture', productName, electronVersion: '40.9.3', directories: { output },
  files: ['dist/**/*', 'package.json'], asar: true, asarUnpack: ['dist/worker/**', 'dist/native/**', 'dist/runtime/**', 'dist/vendor/**'], npmRebuild: false,
  ...(distribution ? { extraResources: [{ from: 'dist/distribution', to: '.' }], artifactName: `OpenApe-Pods-\${version}-\${arch}-${candidate ? 'signed-candidate' : signed ? 'signed' : 'unsigned'}.\${ext}` } : {}),
  mac: { icon: 'build/openape-pods.icns', category: 'public.app-category.productivity', identity: signed ? identity : null, hardenedRuntime: signed, notarize: false, minimumSystemVersion: '14.0', ...(signed ? { entitlements: 'runtime-sources/entitlements.mac.plist', entitlementsInherit: 'runtime-sources/entitlements.mac.plist', signIgnore: ['dist/(native|vendor)/'] } : {}) },
  ...(signed
    ? { afterSign: async (context) => {
        const bundle = join(context.appOutDir, `${productName}.app`); const archive = join(context.appOutDir, 'notarization.zip')
        execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' })
        execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', bundle, archive], { stdio: 'inherit' })
        execFileSync('/usr/bin/xcrun', ['notarytool', 'submit', archive, '--keychain-profile', process.env.OPENAPE_PODS_NOTARY_PROFILE, '--wait'], { stdio: 'inherit', timeout: 1800000 })
        execFileSync('/usr/bin/xcrun', ['stapler', 'staple', bundle], { stdio: 'inherit' }); execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', bundle], { stdio: 'inherit' })
      } }
    : {}),
} })
if (distribution) {
  const files = artifacts.filter(path => path.endsWith('.dmg'))
  if (files.length !== 1) throw new Error('Expected one versioned DMG')
  if (signed) {
    execFileSync('/usr/bin/codesign', ['--timestamp', '--sign', identity, files[0]], { stdio: 'inherit' })
    execFileSync('/usr/bin/xcrun', ['notarytool', 'submit', files[0], '--keychain-profile', process.env.OPENAPE_PODS_NOTARY_PROFILE, '--wait'], { stdio: 'inherit', timeout: 1800000 })
    execFileSync('/usr/bin/xcrun', ['stapler', 'staple', files[0]], { stdio: 'inherit' }); execFileSync('/usr/bin/xcrun', ['stapler', 'validate', files[0]], { stdio: 'inherit' })
  }
  writeFileSync(resolve(output, 'SHA256SUMS'), `${files.map(path => `${sha256(path)}  ${path.split('/').at(-1)}`).join('\n')}\n`)
}
