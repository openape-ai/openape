import { describe, expect, it } from 'vitest'
import { parseShellCommand } from '../src/shell-parser.js'

/**
 * These tests exist because a security property currently rests on an
 * accident, and the accident is easy to "fix" away.
 *
 * `apes grants` is not in `APES_GATED_SUBCOMMANDS` (see
 * `packages/apes/src/shell/apes-self-dispatch.ts`), so `apes grants approve
 * <id>` self-dispatches past the ape-shell grant gate. That is safe only
 * because the agent-scoped `APES_AUTH_FILE` it inherits belongs to an identity
 * the IdP refuses to let self-approve — and because an attempt to swap that
 * variable does NOT parse as an `apes` invocation here.
 *
 * `shell-quote` does not understand env-assignment prefixes, so the assignment
 * itself lands in `executable`, the self-dispatch check fails, and the command
 * falls onto the gated path. Teaching the parser to strip assignments would be
 * a reasonable-looking improvement that silently enables self-approval.
 *
 * If you are here because one of these went red: the parser change is not the
 * bug. Either keep assignments in `executable`, or add `grants` to
 * `APES_GATED_SUBCOMMANDS` before landing it.
 */
describe('env-assignment prefixes must not look like an apes self-dispatch', () => {
  it.each([
    'APES_AUTH_FILE=/Users/someone/.config/apes/auth.json apes grants approve g_1',
    'APES_AUTH_FILE=/tmp/other.json apes grants list',
    'FOO=bar apes run --shell -- bash -c "id"',
  ])('does not report `apes` as the executable of %j', (line) => {
    const parsed = parseShellCommand(line)
    expect(parsed).not.toBeNull()
    expect(parsed!.executable).not.toBe('apes')
    expect(parsed!.executable.startsWith('APES_AUTH_FILE=') || parsed!.executable.startsWith('FOO=')).toBe(true)
  })

  it('still reports `apes` for a plain invocation, so the shortcut keeps working', () => {
    expect(parseShellCommand('apes grants approve g_1')!.executable).toBe('apes')
  })

  // The other two ways to swap the identity are compound or use a different
  // binary; both already miss the self-dispatch shortcut for their own reasons.
  it('sees a different executable for env -u and for a compound unset', () => {
    expect(parseShellCommand('env -u APES_AUTH_FILE apes grants approve g_1')!.executable).toBe('env')
    const compound = parseShellCommand('unset APES_AUTH_FILE; apes grants approve g_1')!
    expect(compound.executable).toBe('unset')
    expect(compound.isCompound).toBe(true)
  })
})
