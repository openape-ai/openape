import type { ToolDefinition } from './index'
import { runVerify } from '../coding/verify'

export const verifyTools: ToolDefinition[] = [
  {
    name: 'verify',
    description: 'Run the verification command (tests/build/lint) in a worktree and report pass/fail. The coding loop must NOT open or merge a PR when this fails. Runs through the DDISA grant cycle (same as bash). Returns { passed, exit_code, stdout, stderr }.',
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Worktree path to run in (e.g. ~/work/issue-42).' },
        command: { type: 'string', description: 'Verification command, e.g. `pnpm test` or `npm run build && npm test`.' },
        timeout_ms: { type: 'number', description: 'Wall-clock cap incl. approval wait. Default 300000.' },
      },
      required: ['cwd', 'command'],
    },
    execute: async (args: unknown) => {
      const a = args as { cwd?: unknown, command?: unknown, timeout_ms?: unknown }
      const timeout = typeof a.timeout_ms === 'number' && a.timeout_ms > 0 ? a.timeout_ms : undefined
      return await runVerify(a.cwd as string, a.command as string, timeout)
    },
  },
]
