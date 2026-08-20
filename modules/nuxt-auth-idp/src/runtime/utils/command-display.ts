/**
 * Presentation helpers for grant requests. ape-shell transports every session
 * command as `bash -c <line>` (packages/apes/src/shell/grant-dispatch.ts) —
 * the wrapper is plumbing, the inner line is what the approver must read.
 */

const SHELL_BINARIES = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])

export interface CommandDisplay {
  /** The command line the approver should read. */
  text: string
  /** Set when the command was wrapped in a shell invocation (`bash -c …`). */
  shell?: string
}

export function unwrapShellCommand(command?: string[]): CommandDisplay | null {
  if (!command || command.length === 0) return null
  const shell = command[0]!.split('/').pop()!
  if (SHELL_BINARIES.has(shell)) {
    const args = command.slice(1)
    const scriptFlagIndex = args.findIndex(arg => arg === '-c' || arg === '-lc')
    const onlyFlagsBefore = args.slice(0, scriptFlagIndex).every(arg => arg.startsWith('-'))
    if (scriptFlagIndex >= 0 && onlyFlagsBefore && args.length > scriptFlagIndex + 1) {
      return { text: args.slice(scriptFlagIndex + 1).join(' '), shell }
    }
  }
  return { text: command.join(' ') }
}

/**
 * Short human name for a grant requester. Agent emails follow
 * `<agent-slug>+<owner-email>@<idp>` — the slug before the `+` is the name an
 * owner recognizes; the rest is routing.
 */
export function formatRequesterName(requester: string): string {
  if (requester.startsWith('agent:')) return `Agent ${requester.slice(6, 14)}…`
  const at = requester.indexOf('@')
  const local = at >= 0 ? requester.slice(0, at) : requester
  const plus = local.indexOf('+')
  return plus > 0 ? local.slice(0, plus) : requester
}
