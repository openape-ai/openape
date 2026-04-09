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

  it('returns error for unsupported mode', () => {
    expect(rewriteApeShellArgs(['/usr/bin/node', '/usr/local/bin/ape-shell', '-i'])).toEqual({ action: 'error' })
    expect(rewriteApeShellArgs(['/usr/bin/node', '/usr/local/bin/ape-shell'])).toEqual({ action: 'error' })
  })

  it('returns error for -c without command', () => {
    expect(rewriteApeShellArgs(['/usr/bin/node', '/usr/local/bin/ape-shell', '-c'])).toEqual({ action: 'error' })
  })
})
