#!/usr/bin/env node
// Installs the owner build from `pnpm package:owner` on this Mac (issue 1519): checks, paired APFS clone backup,
// install, start. Every wait is bounded and nothing waits for a person; a refusal changes nothing.
// Usage: pnpm install:owner [--label NAME] [--keep N] [--profile DIR] [--app PATH] [--rollback DIR]
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const support = join(homedir(), 'Library/Application Support')
const { values: options } = parseArgs({ options: { label: { type: 'string', default: 'owner' }, keep: { type: 'string' }, profile: { type: 'string', default: join(support, 'OpenApe Pods') }, app: { type: 'string', default: join(homedir(), 'Applications/OpenApe Pods.app') }, rollback: { type: 'string', default: join(support, 'OpenApe Pods Rollback') } } })
const started = Date.now()
function fail(message) { console.error(`install:owner refused: ${message}`); process.exit(1) }
const run = (file, args, timeout = 30000) => execFileSync(file, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const manifest = app => JSON.parse(readFileSync(join(app, 'Contents/Resources/pods-distribution.json'), 'utf8'))
const bundleId = app => run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', join(app, 'Contents/Info.plist')])
const gui = () => spawnSync('/usr/bin/pgrep', ['-f', `${options.app}/Contents/MacOS/OpenApe Pods$`]).status === 0
// Only the default profile: a backup restored into profiles/<uuid> (selected-profile.json) is not installed over.
if (existsSync(join(options.profile, 'selected-profile.json'))) fail('a restored profile is selected; install:owner supports only the default profile')
const database = join(options.profile, 'control.sqlite')
const databaseOpen = () => spawnSync('/usr/sbin/lsof', ['-t', database]).status === 0
// A stopped WAL database may have no sidecars. SQLite needs write access to recreate them, even for SELECT.
const query = sql => Number(run('/usr/bin/sqlite3', [`file:${database}?mode=rw`, sql]))
// macOS shows keychain and authorization prompts as SecurityAgent windows (see e2e/fixtures/keychain.ts).
const dialogs = () => Number(run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', 'ObjC.import("CoreGraphics"); ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0))).filter(w => w.kCGWindowOwnerName === "SecurityAgent").length']))
async function until(check, seconds) {
  for (const end = Date.now() + seconds * 1000; Date.now() < end; await new Promise(next => setTimeout(next, 500))) {
    if (check()) return true
  }
  return false
}
const busy = () => query('SELECT count(*) FROM run_leases') > 0 ? 'a run is active' : query('SELECT count(*) FROM work_items WHERE state=\'claimed\'') > 0 ? 'network work is claimed' : null
function quit() { if (gui()) run('/usr/bin/osascript', ['-e', 'with timeout of 20 seconds', '-e', 'tell application id "ai.openape.pods" to quit', '-e', 'end timeout'], 25000) }
const keychainFiles = directory => existsSync(join(directory, 'remote/registration.enc')) || (existsSync(join(directory, 'credentials')) && readdirSync(join(directory, 'credentials')).some(name => /^[a-f0-9-]{36}\.encrypted$/.test(name)))
function files(root) {
  const list = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else list.push(`${relative(root, path)}\t${entry.isFile() ? statSync(path).size : 'link'}`)
    }
  }
  visit(root); return list.sort().join('\n')
}
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')

// 1. The candidate: a valid signature, the same app, a database version it can open, and not already installed.
const build = JSON.parse(readFileSync(resolve('release/distribution/owner-build.json'), 'utf8'))
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', build.bundle])
if (bundleId(build.bundle) !== 'ai.openape.pods' || bundleId(options.app) !== 'ai.openape.pods') fail('the candidate and the installed app must both be ai.openape.pods')
const next = manifest(build.bundle); const current = manifest(options.app)
if (next.sourceRevision !== build.sourceRevision) fail('the candidate manifest does not match owner-build.json')
if (current.sourceRevision === next.sourceRevision) { console.log(`install:owner: ${next.sourceRevision} is already installed; nothing changed`); process.exit(0) }
if (next.schema.minimum > current.schema.current || next.schema.current < current.schema.current) fail(`the candidate cannot open database version ${current.schema.current}`)

// 2. The profile: no running work, and retired keychain files only for a Developer ID build, which migrates them silently.
const developerId = spawnSync('/usr/bin/codesign', ['-dv', build.bundle], { encoding: 'utf8' }).stderr.includes('TeamIdentifier=Q994DN23WB')
if (!developerId && keychainFiles(options.profile)) fail('the profile still holds keychain files; install a Developer ID signed build (package:distribution --signed-local) once to migrate them')
if (busy()) fail(`${busy()}; retry when it has finished`)

// 3. Quit the GUI only; codex-mcp helpers of agent sessions keep running from the moved bundle. Work that started
// between the check and the quit is found again once the database is released, and the app is started again.
const running = gui()
quit()
if (!await until(() => !gui() && !databaseOpen(), 30)) fail('OpenApe Pods did not quit and release its database within 30 s')
let late
try { late = busy() }
catch (error) {
  if (running) run('/usr/bin/open', ['-g', options.app])
  fail(`post-quit database check failed; ${running ? 'the previous app was restarted' : 'the app remains stopped'}: ${error.message}`)
}
if (late) { if (running) run('/usr/bin/open', ['-g', options.app]); fail(`${late}; the app was started again unchanged`) }

// 4. Paired backup: an APFS clone of the quit profile, verified before the app is touched, plus the previous app.
const pair = join(options.rollback, `${new Date().toLocaleString('sv-SE').replace(/[-:]/g, '').replace(' ', '-')}-${options.label.replace(/[^\w.-]/g, '-')}`)
run('/bin/mkdir', ['-p', pair]); run('/bin/cp', ['-c', '-R', '-p', options.profile, join(pair, 'profile')], 120000)
if (gui()) fail(`OpenApe Pods started again during the backup; ${pair} may be inconsistent`)
if (files(options.profile) !== files(join(pair, 'profile')) || sha256(database) !== sha256(join(pair, 'profile/control.sqlite'))) fail(`the backup in ${pair} differs from the profile`)
renameSync(options.app, join(pair, 'OpenApe Pods.app'))

// 5. Install, start in the background and confirm it opened its database without any dialog.
try {
  run('/usr/bin/ditto', [build.bundle, options.app], 120000)
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', options.app])
}
catch (error) {
  rmSync(options.app, { recursive: true, force: true }); renameSync(join(pair, 'OpenApe Pods.app'), options.app)
  fail(`copying the candidate failed and the previous app was put back: ${error.message}`)
}
// Start in the background; a start that fails or asks a person ends the run with the backup path, it never waits.
try { run('/usr/bin/open', ['-g', options.app]) }
catch (error) { fail(`the new app could not be opened (${error.message}); the previous app and profile are in ${pair}`) }
let dialog = false
if (!await until(() => (dialog = dialogs() > 0) || (gui() && databaseOpen()), 60) || dialog) fail(`${dialog ? 'a keychain or authorization dialog opened' : 'OpenApe Pods did not start within 60 s'}; the previous app and profile are in ${pair}`)

// 6. Optional retention: only with --keep N, never the pair just made.
if (options.keep !== undefined) {
  const keep = Number(options.keep); if (!Number.isSafeInteger(keep) || keep < 1) fail('--keep needs a positive whole number')
  const pairs = readdirSync(options.rollback).filter(name => /^\d{8}-\d{6}-/.test(name)).sort().reverse()
  for (const old of pairs.slice(keep)) rmSync(join(options.rollback, old), { recursive: true, force: true })
}
console.log(JSON.stringify({ installed: next.sourceRevision, previous: current.sourceRevision ?? current.version, rollback: pair, seconds: Math.round((Date.now() - started) / 1000) }))
