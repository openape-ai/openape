import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

function run(command, args) { return execFileSync(command, args, { stdio: 'inherit' }) }
for (const script of ['lint', 'typecheck', 'test']) run('pnpm', [script])
if (process.platform !== 'darwin') throw new Error('Native acceptance requires the macOS runner with Xcode and iOS simulators')
const inventory = JSON.parse(execFileSync('xcrun', ['simctl', 'list', '--json'], { encoding: 'utf8' }))
const runtime = inventory.runtimes.filter(item => item.isAvailable && item.identifier.includes('.iOS-')).sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true })).at(-1)
if (!runtime) throw new Error('Install an iOS Simulator runtime in Xcode')
const types = runtime.supportedDeviceTypes
mkdirSync('.artifacts', { recursive: true })
for (const family of ['iPhone', 'iPad']) {
  const type = types.find(item => item.productFamily === family)
  if (!type) throw new Error(`Missing ${family} simulator device type`)
  const device = execFileSync('xcrun', ['simctl', 'create', `Pods acceptance ${family}`, type.identifier, runtime.identifier], { encoding: 'utf8' }).trim()
  try {
    run('xcodebuild', ['-project', 'OpenApePods.xcodeproj', '-scheme', 'OpenApePods', '-destination', `platform=iOS Simulator,id=${device}`, '-derivedDataPath', 'DerivedData', '-resultBundlePath', `.artifacts/${family}-${Date.now()}.xcresult`, 'test'])
  }
  finally { run('xcrun', ['simctl', 'delete', device]) }
}
