import { execFileSync, spawn } from 'node:child_process'
import { startAcceptance } from '../UITests/fixtures.mjs'
import { nativeReport } from '../UITests/report.mjs'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

process.env.DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer'

async function run(command, args, env = process.env) {
  const child = spawn(command, args, { stdio: 'inherit', env })
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))) })
}
// Record the tested source before builds touch tracked files.
mkdirSync('.artifacts', { recursive: true })
const repository = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const sourceHash = createHash('sha256').update(execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: repository, maxBuffer: 1 << 30 }))
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: repository, encoding: 'utf8', maxBuffer: 1 << 30 }).split('\0').filter(Boolean).sort()
for (const path of untracked) {
  // Nested repositories and links are listed as paths but are not source files.
  if (!statSync(resolve(repository, path), { throwIfNoEntry: false })?.isFile()) continue
  sourceHash.update(path).update('\0').update(readFileSync(resolve(repository, path))).update('\0')
}
writeFileSync('.artifacts/native-source.json', JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), workingChangesSHA256: sourceHash.digest('hex') }, null, 2))
for (const script of ['lint', 'typecheck', 'test']) await run('pnpm', [script])
await run('pnpm', ['--filter', '@openape/pods', 'build'])
await run('pnpm', ['--filter', '@openape/pods', 'package:mac'])
if (process.platform !== 'darwin') throw new Error('Native acceptance requires the macOS runner with Xcode and iOS simulators')
const inventory = JSON.parse(execFileSync('xcrun', ['simctl', 'list', '--json'], { encoding: 'utf8' }))
const runtime = inventory.runtimes.filter(item => item.isAvailable && item.identifier.includes('.iOS-')).sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true })).at(-1)
if (!runtime) throw new Error('Install an iOS Simulator runtime in Xcode')
const types = runtime.supportedDeviceTypes
mkdirSync('.artifacts', { recursive: true })
const results = []
for (const family of ['iPhone', 'iPad']) {
  const type = types.find(item => item.productFamily === family)
  if (!type) throw new Error(`Missing ${family} simulator device type`)
  const device = execFileSync('xcrun', ['simctl', 'create', `Pods acceptance ${family}`, type.identifier, runtime.identifier], { encoding: 'utf8' }).trim()
  let fixture
  try {
    fixture = await startAcceptance(family)
    await run('xcrun', ['simctl', 'boot', device])
    await run('xcrun', ['simctl', 'bootstatus', device, '-b'])
    await run('xcrun', ['simctl', 'keychain', device, 'add-root-cert', fixture.certificate])
    const resultPath = `.artifacts/${family}-${Date.now()}.xcresult`
    await run('xcodebuild', ['-project', 'OpenApePods.xcodeproj', '-scheme', 'OpenApePods', '-collect-test-diagnostics', 'never', '-test-timeouts-enabled', 'YES', '-default-test-execution-time-allowance', '300', '-maximum-test-execution-time-allowance', '300', '-destination', `platform=iOS Simulator,id=${device}`, '-derivedDataPath', 'DerivedData', '-resultBundlePath', resultPath, 'test'], { ...process.env, TEST_RUNNER_PODS_ACCEPTANCE_ORIGIN: fixture.origin, TEST_RUNNER_PODS_ACCEPTANCE_EMAIL: fixture.email, TEST_RUNNER_PODS_ACCEPTANCE_CONTROL: fixture.control, TEST_RUNNER_PODS_ACCEPTANCE_TOKEN: fixture.controlToken })
    results.push({ family, path: resultPath })
  }
  finally { try { await fixture?.close() } finally { await run('xcrun', ['simctl', 'delete', device]) } }
}
await nativeReport(results)
