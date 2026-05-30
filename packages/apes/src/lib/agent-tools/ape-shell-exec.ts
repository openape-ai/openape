import { spawn } from 'node:child_process'

// Shared gated-exec path. Every shell command an agent tool runs goes
// through `ape-shell -c <cmd>`, which rewrites to `apes run --shell --
// bash -c …` — i.e. the DDISA grant cycle + shapes-adapter matching,
// identical to what the human owner types interactively. APE_WAIT=1
// forces the blocking path so the tool returns a result instead of
// exiting 75 with grant-pending instructions.
//
// bash.ts and git-worktree.ts both build on this so the gating is
// guaranteed in one place — no tool can shell out un-gated by reaching
// for child_process directly.

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
const MAX_STDIO_BYTES = 64 * 1024
const BIN = 'ape-shell'

export interface ApeShellResult {
  stdout: string
  stderr: string
  exit_code: number
  timed_out?: boolean
  error?: string
  hint?: string
}

function capStdio(s: string): string {
  const buf = Buffer.from(s, 'utf8')
  if (buf.byteLength <= MAX_STDIO_BYTES) return s
  return `${buf.subarray(0, MAX_STDIO_BYTES).toString('utf8')}\n[truncated to ${MAX_STDIO_BYTES} bytes]`
}

export function runApeShell(cmd: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<ApeShellResult> {
  // Container escape hatch: inside the OpenApe pod the container itself
  // IS the sandbox (kernel namespaces + read-only FS overlays) — there's
  // no DDISA layer to gate against, no upstream owner to approve grants,
  // and `ape-shell` would fail at the auth.json check. When
  // OPENAPE_BYPASS_APE_SHELL is set, exec the command via plain bash and
  // surface stdout/stderr/exit_code in the same shape.
  const bypass = process.env.OPENAPE_BYPASS_APE_SHELL === '1'
  const [execBin, execArgs] = bypass
    ? ['/bin/bash', ['-c', cmd]] as const
    : [BIN, ['-c', cmd]] as const
  return new Promise<ApeShellResult>((resolveResult) => {
    const child = spawn(execBin, execArgs, {
      env: { ...process.env, APE_WAIT: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let spawnError: Error | null = null

    child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (err) => { spawnError = err as Error })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      // Force-kill if SIGTERM doesn't take in 5s — happens when the
      // child is wedged waiting on an upstream grant approval.
      setTimeout(() => {
        try { child.kill('SIGKILL') }
        catch { /* already dead */ }
      }, 5000)
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timer)
      if (spawnError) {
        resolveResult({
          stdout: '',
          stderr: '',
          exit_code: -1,
          error: spawnError.message,
          hint: `Could not exec '${execBin}'. The agent host needs @openape/apes installed globally so ape-shell is on PATH (or set OPENAPE_BYPASS_APE_SHELL=1 to skip the gated shell entirely — meant for the OpenApe pod where the container IS the sandbox).`,
        })
        return
      }
      resolveResult({
        stdout: capStdio(stdout),
        stderr: capStdio(stderr),
        exit_code: code ?? -1,
        ...(timedOut ? { timed_out: true } : {}),
      })
    })
  })
}

export const DEFAULTS = { DEFAULT_TIMEOUT_MS }
