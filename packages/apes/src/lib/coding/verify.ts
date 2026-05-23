// Verification loop (M2). Runs the configured test/build command in a
// worktree via the gated ape-shell path and reports pass/fail. This is
// the local gate: the coding loop must NOT proceed to the PR/merge
// phase on a non-zero exit. Branch protection is the second, server-
// side gate.

import { runApeShell } from '../agent-tools/ape-shell-exec'

export interface VerifyResult {
  passed: boolean
  exit_code: number
  stdout: string
  stderr: string
  timed_out?: boolean
}

const CWD_RE = /^[\w./-]{1,256}$/

// Run `command` in `cwd` (a worktree path). The command string is the
// recipe-configured verify command (e.g. `pnpm test`). cwd is charset-
// validated; both go through the gated path so the run is grant-scoped
// exactly like a terminal invocation.
export async function runVerify(cwd: string, command: string, timeoutMs?: number): Promise<VerifyResult> {
  if (typeof cwd !== 'string' || !CWD_RE.test(cwd)) {
    throw new Error('cwd must match ^[A-Za-z0-9._/-]{1,256}$')
  }
  if (typeof command !== 'string' || command.trim() === '') {
    throw new Error('verify command must be a non-empty string')
  }
  // `cd <cwd> && <command>` — cwd validated above; command is the
  // operator-configured verify command (trusted recipe config, not
  // agent free-text).
  const res = await runApeShell(`cd '${cwd}' && ${command}`, timeoutMs)
  return {
    passed: res.exit_code === 0,
    exit_code: res.exit_code,
    stdout: res.stdout,
    stderr: res.stderr,
    ...(res.timed_out ? { timed_out: true } : {}),
  }
}
