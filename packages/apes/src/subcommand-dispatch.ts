import { spawnSync } from 'node:child_process'

/**
 * A subcommand name we are willing to turn into an executable name. Anything
 * with a path separator, a leading dash or a dot could otherwise make
 * `spawnSync` run a file the user never installed.
 */
const SUBCOMMAND_NAME = /^[a-z0-9][a-z0-9-]*$/i

/**
 * git-style dispatch for unknown subcommands: `apes openclaw add x` runs
 * `apes-openclaw add x` from PATH. That makes PATH the plugin registry —
 * installing a subcommand is `npm i -g @openape/apes-openclaw`, removing it is
 * `npm rm -g`. The child reads the same `~/.config/apes/auth.json` through
 * `@openape/cli-auth`, so it needs nothing from this process.
 *
 * Runs before citty sees the args, because otherwise `apes openclaw --help`
 * would be answered with apes' own usage instead of the child's.
 *
 * Returns the child's exit code, or `null` when this is not an external
 * subcommand and the caller should continue with normal dispatch.
 *
 * ponytail: POSIX only — `spawnSync` does not apply PATHEXT, so a Windows
 * `apes-foo.cmd` shim would not resolve. Add a `.cmd` probe if apes ever
 * ships for Windows.
 */
export function dispatchExternalSubcommand(rawArgs: string[], builtins: ReadonlySet<string>): number | null {
  const sub = rawArgs[0]
  if (!sub || builtins.has(sub) || !SUBCOMMAND_NAME.test(sub)) return null

  const result = spawnSync(`apes-${sub}`, rawArgs.slice(1), { stdio: 'inherit' })
  const code = (result.error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT') return null
  if (result.error) throw result.error

  return result.status ?? 1
}
