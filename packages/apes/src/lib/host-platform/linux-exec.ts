// Linux privileged-execution boundary. The nest container runs as PID 1
// (root) so `runPrivilegedBash` is just `bash <script>` — no sudo,
// no escalation prompt, no DDISA grant. `runAsAgentUser` is `sudo -u
// <name> -- <argv>` (sudo is in every distro; the container image
// installs it).
//
// IMPORTANT: keep side-effect-free at top level. Imported on macOS too.

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExecResult } from './index'

export async function runPrivilegedBashOnLinux(script: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'apes-privileged-'))
  const scriptPath = join(dir, 'run.sh')
  writeFileSync(scriptPath, script, { mode: 0o700 })
  try {
    if (process.getuid?.() === 0) {
      execFileSync('bash', [scriptPath], { stdio: 'inherit' })
    }
    else {
      // Non-root entry path (bare-metal Linux without a container). sudo
      // is the canonical escalation; -n forces non-interactive (fail
      // fast if the operator hasn't pre-authorized) so a CI/headless
      // call doesn't hang on a password prompt.
      execFileSync('sudo', ['-n', '--', 'bash', scriptPath], { stdio: 'inherit' })
    }
  }
  finally {
    try { rmSync(dir, { recursive: true, force: true }) }
    catch { /* best-effort */ }
  }
}

export async function runAsAgentUserOnLinux(agentName: string, argv: string[]): Promise<ExecResult> {
  // -u <user> = run as that user. -n = non-interactive (no password
  // prompt — the container's sudoers config grants the nest passwordless
  // sudo to the agent accounts it manages). -H sets HOME to the target
  // user's home dir, which matches the macOS `apes run --as` semantics.
  const r = spawnSync('sudo', ['-n', '-H', '-u', agentName, '--', ...argv], { encoding: 'utf8' })
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    exitCode: r.status ?? 1,
  }
}
