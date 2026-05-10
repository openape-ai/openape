import { spawn } from 'node:child_process'
import type { ToolDefinition } from './index'

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
const MAX_STDIO_BYTES = 64 * 1024

// Spawning `ape-shell -c <cmd>` (instead of building the inner
// `apes run --shell -- bash -c …` ourselves) keeps the tool aligned
// with what the human owner types interactively. ape-shell rewrites
// to the same `apes run --shell` flow, so the grant cycle and the
// shapes-adapter detection are identical to a terminal invocation.
// APE_WAIT=1 forces the blocking path — the tool must return a
// result, not exit-75 with grant-pending instructions.
const BIN = 'ape-shell'

function capStdio(s: string): string {
  const buf = Buffer.from(s, 'utf8')
  if (buf.byteLength <= MAX_STDIO_BYTES) return s
  return `${buf.subarray(0, MAX_STDIO_BYTES).toString('utf8')}\n[truncated to ${MAX_STDIO_BYTES} bytes]`
}

export const bashTools: ToolDefinition[] = [
  {
    name: 'bash',
    description:
      'Run a shell command on the agent host. Every invocation goes through the OpenApe DDISA grant cycle — auto-approved if the owner has a matching YOLO scope, otherwise the owner gets a push notification to approve. Runs as the agent\'s macOS user, so file/network access is limited to what that user can see. Returns stdout, stderr, and exit code. For repeated command patterns ask the owner to set up a YOLO scope so approvals don\'t pile up.',
    parameters: {
      type: 'object',
      properties: {
        cmd: {
          type: 'string',
          description: 'Shell command to run, e.g. `ls -la ~/Documents`, `git status`, `curl -fsSL https://example.com`. The whole string is passed to `bash -c`; quote internally as needed.',
        },
        timeout_ms: {
          type: 'number',
          description: 'Wall-clock cap for the whole approval-and-run cycle in milliseconds. Default 300000 (5 min). Approval waits count against this budget.',
        },
      },
      required: ['cmd'],
    },
    execute: async (args: unknown) => {
      const a = args as { cmd?: unknown, timeout_ms?: unknown }
      if (typeof a.cmd !== 'string' || a.cmd.trim() === '') {
        throw new Error('cmd must be a non-empty string')
      }
      const timeout = typeof a.timeout_ms === 'number' && a.timeout_ms > 0
        ? a.timeout_ms
        : DEFAULT_TIMEOUT_MS

      return await new Promise<unknown>((resolveResult) => {
        const child = spawn(BIN, ['-c', a.cmd as string], {
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
        }, timeout)

        child.on('close', (code) => {
          clearTimeout(timer)
          if (spawnError) {
            resolveResult({
              error: spawnError.message,
              hint: `Could not exec '${BIN}'. The agent host needs @openape/apes installed globally so ape-shell is on PATH.`,
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
    },
  },
]
