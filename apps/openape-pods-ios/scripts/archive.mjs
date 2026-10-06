// Archives the iOS app for TestFlight and, only when App Store Connect API key
// variables are present, uploads it. Without them the signed .ipa stays local so
// the owner can upload through Xcode Organizer or Transporter.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

process.env.DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer'
const build = process.env.PODS_BUILD_NUMBER ?? new Date().toISOString().replace(/\D/g, '').slice(0, 12)
mkdirSync('.artifacts/distribution', { recursive: true })
const archive = `.artifacts/distribution/OpenApePods-${build}.xcarchive`
function run(args) { execFileSync('xcrun', args, { stdio: 'inherit' }) }
run(['xcodebuild', '-project', 'OpenApePods.xcodeproj', '-scheme', 'OpenApePods', '-configuration', 'Release', '-destination', 'generic/platform=iOS', '-archivePath', archive, `CURRENT_PROJECT_VERSION=${build}`, '-allowProvisioningUpdates', 'archive'])
const exportArgs = ['xcodebuild', '-exportArchive', '-archivePath', archive, '-exportOptionsPlist', 'ExportOptions.plist', '-exportPath', `.artifacts/distribution/export-${build}`, '-allowProvisioningUpdates']
const { ASC_KEY_ID: keyId, ASC_ISSUER_ID: issuerId, ASC_KEY_PATH: keyPath } = process.env
if (keyId && issuerId && keyPath && existsSync(keyPath)) {
  exportArgs.push('-authenticationKeyPath', keyPath, '-authenticationKeyID', keyId, '-authenticationKeyIssuerID', issuerId)
  console.log('App Store Connect API key present: exporting with upload-capable authentication')
}
run(exportArgs)
const receipt = { build, archive, exportPath: `.artifacts/distribution/export-${build}`, uploaded: false, head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), at: new Date().toISOString() }
if (keyId && issuerId && keyPath && existsSync(keyPath) && process.env.PODS_UPLOAD === '1') {
  const ipa = execFileSync('bash', ['-c', `ls .artifacts/distribution/export-${build}/*.ipa`], { encoding: 'utf8' }).trim()
  run(['altool', '--upload-app', '--type', 'ios', '--file', ipa, '--apiKey', keyId, '--apiIssuer', issuerId])
  receipt.uploaded = true
}
writeFileSync(`.artifacts/distribution/receipt-${build}.json`, JSON.stringify(receipt, null, 2))
console.log(JSON.stringify(receipt, null, 2))
