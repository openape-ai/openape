import path from 'node:path'

/**
 * Possible actions emitted by `rewriteApeShellArgs` for the caller to
 * dispatch. `rewrite` means argv has been transformed and the normal CLI
 * command dispatch should continue with the new argv. `interactive` means
 * the caller should hand control to the interactive REPL. The other
 * actions print version/help/error text and exit.
 */
export type ApeShellAction =
  | { action: 'rewrite', argv: string[] }
  | { action: 'version' }
  | { action: 'help' }
  | { action: 'error' }
  | { action: 'interactive' }

/**
 * Decides how `ape-shell` was invoked and what the caller should do next.
 * Backward compatibility is strict: any invocation with `-c "<command>"`
 * keeps the historical rewrite behavior so `SHELL=$(which ape-shell) <prog>`
 * patterns (e.g. `SHELL=ape-shell openclaw tui`) continue to work.
 *
 * Detection rules (first match wins):
 *   • basename != ape-shell → not an ape-shell invocation, returns null.
 *   • `-c <command>` → rewrite to `apes run --shell -- bash -c <command>`.
 *   • `--version` / `-v` → version action.
 *   • `--help` / `-h` → help action.
 *   • no args, `-i`, `-l`, `--login`, or argv[0] starts with `-`
 *     (login-shell convention from sshd/login) → interactive REPL.
 *   • anything else → error action.
 */
export function rewriteApeShellArgs(argv: string[]): ApeShellAction | null {
  const rawInvokedAs = argv[1] ?? ''
  // sshd/login use a leading dash on argv[0] to signal "login shell".
  // Strip it for the basename comparison, but remember the flag.
  const looksLikeLoginShell = rawInvokedAs.startsWith('-')
  const normalizedInvokedAs = looksLikeLoginShell ? rawInvokedAs.slice(1) : rawInvokedAs
  const invokedAs = path.basename(normalizedInvokedAs)
  if (invokedAs !== 'ape-shell' && invokedAs !== 'ape-shell.js')
    return null

  const shellArgs = argv.slice(2)

  // -c <command> is the historical one-shot path — must stay untouched so
  // programs that use `$SHELL -c "<cmd>"` (openclaw tui, xargs, git hooks,
  // sshd non-interactive, etc.) continue to work unchanged.
  if (shellArgs[0] === '-c' && shellArgs.length > 1) {
    return { action: 'rewrite', argv: [argv[0]!, argv[1]!, 'run', '--shell', '--', 'bash', '-c', ...shellArgs.slice(1)] }
  }

  if (shellArgs[0] === '--version' || shellArgs[0] === '-v')
    return { action: 'version' }

  if (shellArgs[0] === '--help' || shellArgs[0] === '-h')
    return { action: 'help' }

  // No positional args, explicit interactive flag, or login-shell
  // convention (`looksLikeLoginShell` detected from the dash-prefixed
  // argv[1] above) → enter the interactive REPL.
  if (
    shellArgs.length === 0
    || shellArgs[0] === '-i'
    || shellArgs[0] === '-l'
    || shellArgs[0] === '--login'
    || looksLikeLoginShell
  ) {
    return { action: 'interactive' }
  }

  return { action: 'error' }
}
