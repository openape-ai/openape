// macOS implementation of installNestSupervisor / uninstallNestSupervisor.
// Writes the per-user launchd plist at `~/Library/LaunchAgents/ai.openape.nest.plist`
// and bootstraps it into the gui/<uid> domain (the nest runs as the human
// user in Stage 1). Idempotent: re-installing rewrites the plist + reloads.
//
// IMPORTANT: this module is imported via the darwin-only branch of
// `host-platform/darwin.ts` (which is itself only reachable from
// `getHostPlatform()` on darwin). Keep side-effect-free at top level so
// the Linux build can still parse it during a monorepo-wide typecheck.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import type { NestSupervisorSpec } from './index'

const PLIST_LABEL = 'ai.openape.nest'

function plistPath(userHome: string): string {
  return join(userHome, 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`)
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function buildNestPlist(spec: NestSupervisorSpec): string {
  const logsDir = join(spec.userHome, 'Library', 'Logs')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(PLIST_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(spec.nestBin)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(spec.nestHome)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${xmlEscape(spec.nestHome)}</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>OPENAPE_NEST_PORT</key><string>${spec.port}</string>
    <key>OPENAPE_APES_BIN</key><string>${xmlEscape(spec.apesBin)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logsDir)}/openape-nest.log</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logsDir)}/openape-nest.log</string>
</dict>
</plist>
`
}

export async function installNestSupervisorOnDarwin(spec: NestSupervisorSpec): Promise<void> {
  const path = plistPath(spec.userHome)
  mkdirSync(join(spec.userHome, 'Library', 'LaunchAgents'), { recursive: true })
  const desired = buildNestPlist(spec)
  let existing = ''
  try { existing = readFileSync(path, 'utf8') }
  catch { /* not yet installed */ }
  if (existing !== desired) {
    writeFileSync(path, desired, { mode: 0o644 })
  }
  const uid = userInfo().uid
  // bootout no-ops if not loaded; bootstrap fails loud on a syntax error.
  try { execFileSync('/bin/launchctl', ['bootout', `gui/${uid}/${PLIST_LABEL}`], { stdio: 'ignore' }) }
  catch { /* not loaded */ }
  execFileSync('/bin/launchctl', ['bootstrap', `gui/${uid}`, path], { stdio: 'inherit' })
}

export async function uninstallNestSupervisorOnDarwin(): Promise<void> {
  const home = userInfo().homedir
  const uid = userInfo().uid
  const path = plistPath(home)
  try { execFileSync('/bin/launchctl', ['bootout', `gui/${uid}/${PLIST_LABEL}`], { stdio: 'ignore' }) }
  catch { /* not loaded */ }
  if (existsSync(path)) unlinkSync(path)
}
