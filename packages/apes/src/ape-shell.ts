import path from 'node:path'

/**
 * Detects if apes was invoked as "ape-shell" (via argv[0]/symlink) and rewrites
 * the process arguments to route through `apes run --shell`.
 *
 * ape-shell -c "git status" → apes run --shell -- bash -c "git status"
 */
export function rewriteApeShellArgs(argv: string[]): { action: 'rewrite', argv: string[] } | { action: 'version' } | { action: 'help' } | { action: 'error' } | null {
  const invokedAs = path.basename(argv[1] ?? '')
  if (invokedAs !== 'ape-shell' && invokedAs !== 'ape-shell.js')
    return null

  const shellArgs = argv.slice(2)
  if (shellArgs[0] === '-c' && shellArgs.length > 1) {
    return { action: 'rewrite', argv: [argv[0]!, argv[1]!, 'run', '--shell', '--', 'bash', '-c', ...shellArgs.slice(1)] }
  }
  if (shellArgs[0] === '--version')
    return { action: 'version' }
  if (shellArgs[0] === '--help' || shellArgs[0] === '-h')
    return { action: 'help' }
  return { action: 'error' }
}
