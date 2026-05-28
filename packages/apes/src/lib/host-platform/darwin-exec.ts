// macOS privileged-execution boundary. Both runPrivilegedBash + runAsAgentUser
// route through `apes run --as <user> --wait --` which goes through the
// DDISA grant cycle (escapes setuid). When we're already running as the
// target user (root path: process.getuid() === 0), short-circuit and exec
// bash directly — that saves a redundant grant prompt when the caller
// already escalated (e.g. nest → `apes run --as root -- apes agents spawn`,
// which we don't want to escalate a second time inside).
//
// IMPORTANT: keep side-effect-free at top level — imported on Linux too.

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExecResult } from './index'

function resolveApesBinary(): string {
  // `which apes` would work too, but argv[0] is the resilient choice — it
  // matches the binary that's currently running, so the escalation hits the
  // same code (no version mismatch between global apes and the dist one in
  // use). OPENAPE_APES_BIN is set by the nest's launchd plist.
  return process.env.OPENAPE_APES_BIN || 'apes'
}

export async function runPrivilegedBashOnDarwin(script: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'apes-privileged-'))
  const scriptPath = join(dir, 'run.sh')
  writeFileSync(scriptPath, script, { mode: 0o700 })
  try {
    if (process.getuid?.() === 0) {
      execFileSync('bash', [scriptPath], { stdio: 'inherit' })
    }
    else {
      execFileSync(resolveApesBinary(), ['run', '--as', 'root', '--wait', '--', 'bash', scriptPath], { stdio: 'inherit' })
    }
  }
  finally {
    try { rmSync(dir, { recursive: true, force: true }) }
    catch { /* best-effort */ }
  }
}

export async function runAsAgentUserOnDarwin(agentName: string, argv: string[]): Promise<ExecResult> {
  const r = spawnSync(
    resolveApesBinary(),
    ['run', '--as', agentName, '--wait', '--', ...argv],
    { encoding: 'utf8' },
  )
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    exitCode: r.status ?? 1,
  }
}
