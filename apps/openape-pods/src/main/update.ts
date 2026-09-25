import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'

export interface DistributionManifest { format: 'openape-pods-distribution', version: string, platform: 'darwin', architecture: string, schema: { minimum: number, current: number }, releaseReady: boolean }
type Run = (binary: string, args: string[]) => Promise<{ stdout: string, stderr: string }>
const execute = promisify(execFile)
const runCommand: Run = (binary, args) => execute(binary, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024, env: { PATH: '/usr/bin:/bin' } })
function version(value: string): number[] {
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error('Updates require a stable three-part version')
  const parts = value.split('.').map(Number)
  if (parts.some(part => !Number.isSafeInteger(part))) throw new Error('Invalid application version')
  return parts
}
export function assertUpdate(current: DistributionManifest, candidate: DistributionManifest): void {
  if (current.format !== 'openape-pods-distribution' || candidate.format !== current.format || current.platform !== 'darwin' || candidate.platform !== current.platform || candidate.architecture !== process.arch || current.architecture !== process.arch || !candidate.releaseReady) throw new Error('Update is not an approved build for this Mac')
  const previous = version(current.version); const next = version(candidate.version)
  const different = next.findIndex((value, index) => value !== previous[index])
  if (different === -1 || next[different] < previous[different]) throw new Error('Choose a newer version; rollback requires the compatible pre-update backup')
  if (![current.schema?.current, candidate.schema?.minimum, candidate.schema?.current].every(value => Number.isSafeInteger(value) && value >= 1) || candidate.schema.minimum > current.schema.current || candidate.schema.current < current.schema.current) throw new Error('Update cannot migrate this database version')
}
async function manifest(path: string): Promise<DistributionManifest> {
  const file = join(path, 'Contents/Resources/pods-distribution.json'); const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error('Invalid distribution manifest')
  return JSON.parse(await readFile(file, 'utf8')) as DistributionManifest
}
async function signedApp(path: string, run: Run): Promise<string> {
  if (!path.endsWith('.app') || await realpath(path) !== path || !(await lstat(path)).isDirectory()) throw new Error('Choose a local application bundle without links')
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path])
  await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', path])
  const detail = await run('/usr/bin/codesign', ['--display', '--verbose=4', path])
  const team = /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(detail.stderr)?.[1]
  if (!team || !/flags=.*\bruntime\b/.test(detail.stderr)) throw new Error('App requires a Developer ID signature with hardened runtime')
  const identity = await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(path, 'Contents/Info.plist')])
  if (identity.stdout.trim() !== 'ai.openape.pods') throw new Error('Unexpected application identity')
  return team
}
export async function verifyUpdate(current: string, candidate: string, run: Run = runCommand): Promise<DistributionManifest> {
  const previousTeam = await signedApp(current, run); const nextTeam = await signedApp(candidate, run)
  if (previousTeam !== nextTeam) throw new Error('Update publisher differs from the installed application')
  const previous = await manifest(current); const next = await manifest(candidate)
  assertUpdate(previous, next)
  const bundleVersion = await run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', join(candidate, 'Contents/Info.plist')])
  if (bundleVersion.stdout.trim() !== next.version) throw new Error('Update version differs from its signed manifest')
  return next
}
