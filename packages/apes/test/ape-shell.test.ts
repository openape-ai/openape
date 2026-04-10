import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rewriteApeShellArgs } from '../src/ape-shell'

describe('ape-shell argv rewriting', () => {
  it('returns null when not invoked as ape-shell', () => {
    expect(rewriteApeShellArgs(['/usr/bin/node', '/usr/local/bin/apes', 'login'])).toBeNull()
    expect(rewriteApeShellArgs(['/usr/bin/node', '/usr/local/bin/apes', 'run', '--', 'git', 'status'])).toBeNull()
  })

  it('rewrites -c command to apes run --shell', () => {
    const result = rewriteApeShellArgs(['/usr/bin/node', '/usr/local/bin/ape-shell', '-c', 'git status'])
    expect(result).toEqual({
      action: 'rewrite',
      argv: ['/usr/bin/node', '/usr/local/bin/ape-shell', 'run', '--shell', '--', 'bash', '-c', 'git status'],
    })
  })

  it('rewrites -c with compound command', () => {
    const result = rewriteApeShellArgs(['/usr/bin/node', '/usr/local/bin/ape-shell', '-c', 'git status && npm test'])
    expect(result).toEqual({
      action: 'rewrite',
      argv: ['/usr/bin/node', '/usr/local/bin/ape-shell', 'run', '--shell', '--', 'bash', '-c', 'git status && npm test'],
    })
  })

  it('handles ape-shell.js extension', () => {
    const result = rewriteApeShellArgs(['/usr/bin/node', '/path/to/ape-shell.js', '-c', 'echo hello'])
    expect(result).toEqual({
      action: 'rewrite',
      argv: ['/usr/bin/node', '/path/to/ape-shell.js', 'run', '--shell', '--', 'bash', '-c', 'echo hello'],
    })
  })

  it('returns version action', () => {
    expect(rewriteApeShellArgs(['/usr/bin/node', '/usr/local/bin/ape-shell', '--version'])).toEqual({ action: 'version' })
  })

  it('returns help action', () => {
    expect(rewriteApeShellArgs(['/usr/bin/node', '/usr/local/bin/ape-shell', '--help'])).toEqual({ action: 'help' })
    expect(rewriteApeShellArgs(['/usr/bin/node', '/usr/local/bin/ape-shell', '-h'])).toEqual({ action: 'help' })
  })

  it('returns interactive action when invoked with no args', () => {
    expect(rewriteApeShellArgs(['/usr/bin/node', '/usr/local/bin/ape-shell'])).toEqual({ action: 'interactive' })
  })

  it('returns interactive action for explicit -i flag', () => {
    expect(rewriteApeShellArgs(['/usr/bin/node', '/usr/local/bin/ape-shell', '-i'])).toEqual({ action: 'interactive' })
  })

  it('returns interactive action for -l / --login flag', () => {
    expect(rewriteApeShellArgs(['/usr/bin/node', '/usr/local/bin/ape-shell', '-l'])).toEqual({ action: 'interactive' })
    expect(rewriteApeShellArgs(['/usr/bin/node', '/usr/local/bin/ape-shell', '--login'])).toEqual({ action: 'interactive' })
  })

  it('returns interactive action when argv[1] starts with a dash (sshd login-shell convention)', () => {
    // sshd prepends `-` to argv[0] to signal "this is a login shell"
    expect(rewriteApeShellArgs(['/usr/bin/node', '-ape-shell'])).toEqual({ action: 'interactive' })
  })

  it('returns error for -c without command', () => {
    expect(rewriteApeShellArgs(['/usr/bin/node', '/usr/local/bin/ape-shell', '-c'])).toEqual({ action: 'error' })
  })

  it('returns error for unsupported mode (positional script file)', () => {
    expect(rewriteApeShellArgs(['/usr/bin/node', '/usr/local/bin/ape-shell', 'script.sh'])).toEqual({ action: 'error' })
  })

  it('keeps the -c one-shot path even when SHELL=ape-shell is used (non-regression)', () => {
    // Simulate `SHELL=/usr/local/bin/ape-shell openclaw tui` which
    // eventually spawns `/usr/local/bin/ape-shell -c "<cmd>"` — must route
    // through the existing one-shot rewrite, not the interactive REPL.
    const result = rewriteApeShellArgs(['/usr/bin/node', '/usr/local/bin/ape-shell', '-c', 'echo hello'])
    expect(result?.action).toBe('rewrite')
  })

  describe('wrapper-script invocation (APES_SHELL_WRAPPER env var)', () => {
    const savedEnv = process.env.APES_SHELL_WRAPPER

    beforeEach(() => {
      process.env.APES_SHELL_WRAPPER = '1'
    })

    afterEach(() => {
      if (savedEnv === undefined) delete process.env.APES_SHELL_WRAPPER
      else process.env.APES_SHELL_WRAPPER = savedEnv
    })

    it('recognizes wrapper invocation with no args as interactive', () => {
      // Wrapper execs node cli.js with no trailing args — argv[1] becomes
      // the cli.js path. Without the wrapper env var we would return null
      // (not recognized as ape-shell). With it, we should enter the REPL.
      const result = rewriteApeShellArgs([
        '/opt/homebrew/bin/node',
        '/Users/someone/openape/packages/apes/dist/cli.js',
      ])
      expect(result).toEqual({ action: 'interactive' })
    })

    it('recognizes wrapper invocation with -c as one-shot rewrite', () => {
      const result = rewriteApeShellArgs([
        '/opt/homebrew/bin/node',
        '/Users/someone/openape/packages/apes/dist/cli.js',
        '-c',
        'echo hi',
      ])
      expect(result?.action).toBe('rewrite')
    })

    it('detects login-shell convention via argv0 (wrapper preserves it via exec -a)', () => {
      // When the wrapper script does `exec -a "$0" node cli.js`, the node
      // process's argv0 becomes "-ape-shell" (dash-prefixed from login).
      // argv[1] is cli.js. Detection needs to see the dash via the argv0
      // parameter.
      const result = rewriteApeShellArgs(
        ['/opt/homebrew/bin/node', '/Users/someone/openape/packages/apes/dist/cli.js'],
        '-ape-shell',
      )
      expect(result).toEqual({ action: 'interactive' })
    })

    it('returns null when wrapper env var is unset and argv does not match', () => {
      delete process.env.APES_SHELL_WRAPPER
      const result = rewriteApeShellArgs([
        '/opt/homebrew/bin/node',
        '/Users/someone/openape/packages/apes/dist/cli.js',
      ])
      expect(result).toBeNull()
    })
  })
})
