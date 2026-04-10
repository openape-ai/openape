import { describe, expect, it } from 'vitest'
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
})
