import type { ToolDefinition } from './index'
import { DEFAULTS, runApeShell } from './ape-shell-exec'

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
        : DEFAULTS.DEFAULT_TIMEOUT_MS
      return await runApeShell(a.cmd, timeout)
    },
  },
]
