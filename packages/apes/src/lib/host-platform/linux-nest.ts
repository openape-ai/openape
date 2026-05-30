// Linux nest supervisor — systemd unit at /etc/systemd/system/openape-nest.service.
// daemon-reload + enable --now is idempotent. The systemctl invocations
// need root, which the nest already has when it self-installs (it runs
// as PID 1 in the container, or as a systemd-managed service on bare
// metal where the install command is invoked with sudo).
//
// IMPORTANT: keep side-effect-free at top level — imported on macOS too.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import type { NestSupervisorSpec } from './index'

const UNIT_NAME = 'openape-nest.service'
const UNIT_PATH = `/etc/systemd/system/${UNIT_NAME}`

export function buildNestUnit(spec: NestSupervisorSpec): string {
  // Type=simple — the nest process stays in the foreground.
  // Restart=always with a 10s back-off matches the macOS plist's
  // KeepAlive + ThrottleInterval semantics.
  // Environment lines mirror the macOS plist's EnvironmentVariables.
  // No User= → systemd runs the unit as root, same as the launchd
  // system-domain path. (When we migrate to a dedicated openape user
  // this becomes `User=openape`.)
  return `[Unit]
Description=OpenApe Nest supervisor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${spec.nestBin}
WorkingDirectory=${spec.nestHome}
Restart=always
RestartSec=10
Environment=HOME=${spec.nestHome}
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=OPENAPE_NEST_PORT=${spec.port}
Environment=OPENAPE_APES_BIN=${spec.apesBin}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`
}

export async function installNestSupervisorOnLinux(spec: NestSupervisorSpec): Promise<void> {
  const desired = buildNestUnit(spec)
  let existing = ''
  try { existing = readFileSync(UNIT_PATH, 'utf8') }
  catch { /* fresh install */ }
  if (existing !== desired) {
    writeFileSync(UNIT_PATH, desired, { mode: 0o644 })
  }
  execFileSync('systemctl', ['daemon-reload'], { stdio: 'inherit' })
  execFileSync('systemctl', ['enable', '--now', UNIT_NAME], { stdio: 'inherit' })
}

export async function uninstallNestSupervisorOnLinux(): Promise<void> {
  // stop + disable are idempotent — they no-op cleanly when the unit
  // isn't loaded. Then drop the file and reload so systemd forgets it.
  try { execFileSync('systemctl', ['disable', '--now', UNIT_NAME], { stdio: 'inherit' }) }
  catch { /* not enabled */ }
  if (existsSync(UNIT_PATH)) unlinkSync(UNIT_PATH)
  try { execFileSync('systemctl', ['daemon-reload'], { stdio: 'inherit' }) }
  catch { /* best-effort */ }
}
