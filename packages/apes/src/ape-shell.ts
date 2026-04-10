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
 * Detection strategy:
 *   1. `process.env.APES_SHELL_WRAPPER === '1'` is the strongest signal —
 *      it means we were invoked via the ape-shell-wrapper.sh shell script,
 *      which hoists node onto PATH before exec-ing cli.js. In that case
 *      argv[1] becomes `cli.js` (or some dist/chunk file) and the old
 *      basename check fails, so we trust the wrapper's declaration.
 *   2. Otherwise fall back to `argv[1]` basename matching literal
 *      `ape-shell` / `ape-shell.js` (the direct-symlink invocation path).
 *
 * After detection, the rest of the rules decide the action (first match):
 *   • `-c <command>` → rewrite to `apes run --shell -- bash -c <command>`.
 *   • `--version` / `-v` → version action.
 *   • `--help` / `-h` → help action.
 *   • no args, `-i`, `-l`, `--login`, or a login-shell convention dash
 *     prefix (on argv[1] or argv0) → interactive REPL.
 *   • anything else → error action.
 */
export function rewriteApeShellArgs(argv: string[], argv0?: string): ApeShellAction | null {
  const rawInvokedAs = argv[1] ?? ''
  // sshd/login use a leading dash on argv[0] to signal "login shell".
  // Strip it for the basename comparison, but remember the flag. The dash
  // may appear on argv[1] (direct invocation) or on the separately-passed
  // argv0 parameter (wrapper invocation — shell `exec -a "$0"` sets node's
  // actual argv[0] / `process.argv0` independently from argv[1]).
  const dashFromArgv1 = rawInvokedAs.startsWith('-')
  const dashFromArgv0 = typeof argv0 === 'string' && argv0.startsWith('-')
  const looksLikeLoginShell = dashFromArgv1 || dashFromArgv0
  const normalizedInvokedAs = dashFromArgv1 ? rawInvokedAs.slice(1) : rawInvokedAs
  const invokedAs = path.basename(normalizedInvokedAs)

  // Primary detection: explicit wrapper signal via env var. Takes
  // precedence because argv-based detection gets clobbered when the
  // wrapper execs node directly and argv[1] becomes cli.js.
  const wrapperEnv = typeof process !== 'undefined' && process.env?.APES_SHELL_WRAPPER === '1'

  // Secondary detection: argv[1] basename matches literal `ape-shell` or
  // `ape-shell.js` — the direct-symlink invocation path.
  const argvMatch = invokedAs === 'ape-shell' || invokedAs === 'ape-shell.js'

  if (!wrapperEnv && !argvMatch)
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
