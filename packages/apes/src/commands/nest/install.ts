// `apes nest install` — bootstrap the local nest-daemon.
//
// Stage 1 MVP: the daemon runs as the human user (a future stage will
// migrate to a dedicated `_openape_nest` service-account). Setup is
// three things:
//
//   1. Write ~/Library/LaunchAgents/ai.openape.nest.plist (user domain
//      — autostarts at login, KeepAlive=true)
//   2. `launchctl bootstrap` the plist into the user-launchd domain
//   3. Print instructions for the always-grant the user needs to
//      approve once at id.openape.ai/grant-approval
//
// Idempotent — re-running on an already-installed nest just re-bootstraps
// (effectively a restart).

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { defineCommand } from 'citty'
import consola from 'consola'

const PLIST_LABEL = 'ai.openape.nest'

function plistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`)
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface PlistArgs {
  nestBin: string
  apesBin: string
  homeDir: string
  port: number
}

function buildPlist(args: PlistArgs): string {
  const logsDir = join(args.homeDir, 'Library', 'Logs')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escape(PLIST_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escape(args.nestBin)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escape(args.homeDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${escape(args.homeDir)}</string>
    <key>PATH</key><string>${escape(args.homeDir)}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>OPENAPE_NEST_PORT</key><string>${args.port}</string>
    <key>OPENAPE_APES_BIN</key><string>${escape(args.apesBin)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${escape(logsDir)}/openape-nest.log</string>
  <key>StandardErrorPath</key>
  <string>${escape(logsDir)}/openape-nest.log</string>
</dict>
</plist>
`
}

function findBinary(name: string): string {
  for (const dir of [
    join(homedir(), '.bun', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ]) {
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  throw new Error(`could not locate ${name} on PATH; install it first`)
}

export const installNestCommand = defineCommand({
  meta: {
    name: 'install',
    description: 'Install + start the local nest-daemon (idempotent — re-running just restarts)',
  },
  args: {
    port: {
      type: 'string',
      description: 'Port for the nest HTTP API (default: 9091)',
    },
  },
  async run({ args }) {
    const homeDir = homedir()
    const port = Number(args.port ?? 9091)
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error(`invalid port ${port}`)
    }
    const nestBin = findBinary('openape-nest')
    const apesBin = findBinary('apes')

    consola.info(`Installing nest at ${plistPath()}`)
    consola.info(`  nest binary: ${nestBin}`)
    consola.info(`  apes binary: ${apesBin}`)
    consola.info(`  HTTP port:   ${port}`)

    mkdirSync(join(homeDir, 'Library', 'LaunchAgents'), { recursive: true })

    const desired = buildPlist({ nestBin, apesBin, homeDir, port })
    let existing = ''
    try { existing = readFileSync(plistPath(), 'utf8') }
    catch { /* not yet installed */ }

    if (existing !== desired) {
      writeFileSync(plistPath(), desired, { mode: 0o644 })
      consola.success('Wrote launchd plist')
    }
    else {
      consola.info('plist already up to date')
    }

    // Idempotent (re)load. bootout silently no-ops if the job isn't
    // loaded yet; bootstrap fails loud if the plist has a syntax error,
    // which is what we want.
    const uid = userInfo().uid
    try {
      execFileSync('/bin/launchctl', ['bootout', `gui/${uid}/${PLIST_LABEL}`], { stdio: 'ignore' })
    }
    catch { /* not loaded */ }
    execFileSync('/bin/launchctl', ['bootstrap', `gui/${uid}`, plistPath()], { stdio: 'inherit' })
    consola.success(`Nest daemon bootstrapped — http://127.0.0.1:${port}`)

    consola.info('')
    consola.info('Next: approve the always-grant for nest-managed spawn/destroy.')
    consola.info('Run this once and choose "Always" when the IdP UI prompts:')
    consola.info('')
    consola.info('  apes run --as root --approval=always --reason "nest-managed agent spawn" \\')
    consola.info('    -- apes agents spawn _grant_pattern_seed_')
    consola.info('')
    consola.info('(The seed-spawn will fail because "_grant_pattern_seed_" is not a valid')
    consola.info('agent name — that\'s expected. The grant just needs to be approved-as-always.)')
  },
})
