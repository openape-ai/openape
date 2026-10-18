import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rewriteApeShellArgs } from '../src/ape-shell'
import { parseMachineRequest } from '../src/authorization/machine-request'

describe('ape-shell argv rewriting', () => {
  it('accepts owner scripts only over the private request channel', () => {
    expect(rewriteApeShellArgs(['node', 'ape-shell', '--run-script', '--request-fd', '6'])).toEqual({ action: 'owner-script' })
    for (const args of [[], ['script.mjs'], ['--request-fd', '3'], ['--request-fd', '6', 'extra'], ['--request-fd', '6', '-c', 'echo hello']]) expect(rewriteApeShellArgs(['node', 'ape-shell', '--run-script', ...args])).toEqual({ action: 'error' })
  })

  it('binds owner activation to the script and rejects mixing the two authority modes', () => {
    const podId = '12345678-1234-4123-8123-123456789abc'
    const scriptHash = 'c'.repeat(64)
    const authority = { source: 'owner-activation', activationId: `${podId}:${scriptHash}:1:2`, podId, scriptHash, assignmentRevision: 1, resourceEpoch: 2 }
    const request = { version: 1, mode: 'owner-script', authority, operationId: 'operation', executable: { path: '/bin/node', sha256: 'a'.repeat(64) }, argv: ['/workspace/script.mjs'], files: [{ path: '/workspace/script.mjs', sha256: scriptHash }], cwd: '/workspace', environment: {}, targetHost: `pods:${podId}`, sandbox: { path: '/private/profile.sb', sha256: 'b'.repeat(64) }, forwardChannel: true }
    expect(parseMachineRequest(request, 'owner-script')).toEqual(request)
    expect(() => parseMachineRequest(request)).toThrow()
    for (const invalid of [{ ...request, authority: undefined }, { ...request, authority: { ...authority, scriptHash: 'd'.repeat(64) } }, { ...request, targetHost: 'pods:another-pod' }, { ...request, grantType: 'always' }, { ...request, waitMs: 1 }, { ...request, authority: { ...authority, approved: true } }, { ...request, authority: { ...authority, assignmentRevision: 0 } }, { ...request, authority: { ...authority, activationId: `${authority.activationId}\n` } }, { ...request, authority: { ...authority, scriptHash: `${scriptHash}\n` } }, { ...request, environment: { APES_SHELL_MODE: '1' } }]) expect(() => parseMachineRequest(invalid, 'owner-script')).toThrow()
  })

  it('keeps structured requests separate from shell text, including malformed invocations', () => {
    expect(rewriteApeShellArgs(['node', 'ape-shell', '-c', '--request-fd', '6'])).toEqual({ action: 'machine' })
    for (const arguments_ of [[], [''], ['3'], ['6', 'extra']]) expect(rewriteApeShellArgs(['node', 'ape-shell', '-c', '--request-fd', ...arguments_])).toEqual({ action: 'error' })
  })

  it('refuses caller-supplied approvals, arbitrary wrappers and implicit authority in machine context', () => {
    const request = { version: 1, operationId: 'operation', executable: { path: '/bin/tool', sha256: 'a'.repeat(64) }, argv: [], cwd: '/workspace', environment: {}, targetHost: 'host', grantType: 'once', sandbox: { path: '/private/profile.sb', sha256: 'b'.repeat(64) }, forwardChannel: false, waitMs: 0 }
    expect(parseMachineRequest(request)).toMatchObject({ operationId: 'operation', grantType: 'once' })
    const batch = { id: 'selected-calls', title: 'Review selected calls', description: 'Review each selected call.\nEvery approval remains single-use.', size: 2 }
    expect(parseMachineRequest({ ...request, batch }).batch).toEqual(batch)
    expect(() => parseMachineRequest({ ...request, batch: { ...batch, description: 'Review\u202Eselected calls' } })).toThrow()
    for (const invalid of [{ ...request, approved: true }, { ...request, wrapper: '/bin/sh' }, { ...request, grantType: undefined }, { ...request, environment: { APES_SHELL_MODE: '1' } }, { ...request, executable: { ...request.executable, sha256: '' } }]) expect(() => parseMachineRequest(invalid)).toThrow()
  })
  it('forwards exact program arguments without enabling shell mode', () => {
    const command = ['node', '-e', 'console.log(2 + 2)', '', 'Grüße', '$HOME', 'a\nb', '$(touch marker)', '>', 'a && b', '--as', 'root']
    expect(rewriteApeShellArgs(['node', 'ape-shell', '-c', '--', ...command])).toEqual({
      action: 'rewrite',
      argv: ['node', 'ape-shell', 'run', '--', ...command],
    })
  })

  it.each([{ command: [] }, { command: [''] }, { command: ['node', 'a\0b'] }])('refuses invalid exact calls without a shell fallback: $command', ({ command }) => {
    expect(rewriteApeShellArgs(['node', 'ape-shell', '-c', '--', ...command])).toEqual({ action: 'error' })
  })

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

    it('documents the shim failure mode: -c via bare cli.js without any signal is NOT rewritten', () => {
      // A package-manager shim (pnpm) execs `node .../dist/cli.js "$@"`
      // directly — argv[1] is cli.js, no env signal. Detection must NOT
      // fire (this argv is indistinguishable from a plain `apes -c` typo),
      // which is exactly why the published `ape-shell` bin must be the
      // wrapper script: without it the -c command silently never runs.
      delete process.env.APES_SHELL_WRAPPER
      const result = rewriteApeShellArgs(['node', '/x/dist/cli.js', '-c', 'echo hi'])
      expect(result).toBeNull()
    })

    it('rewrites the shim argv shape when APES_SHELL_WRAPPER=1 is set', () => {
      const result = rewriteApeShellArgs(['node', '/x/dist/cli.js', '-c', 'echo hi'])
      expect(result).toEqual({
        action: 'rewrite',
        argv: ['node', '/x/dist/cli.js', 'run', '--shell', '--', 'bash', '-c', 'echo hi'],
      })
    })
  })

  describe('explicit shell-mode switch (APES_SHELL_MODE env var)', () => {
    const savedEnv = process.env.APES_SHELL_MODE

    beforeEach(() => {
      process.env.APES_SHELL_MODE = '1'
    })

    afterEach(() => {
      if (savedEnv === undefined) delete process.env.APES_SHELL_MODE
      else process.env.APES_SHELL_MODE = savedEnv
    })

    it('treats APES_SHELL_MODE=1 as equivalent to the wrapper signal for -c', () => {
      const result = rewriteApeShellArgs(['node', '/x/dist/cli.js', '-c', 'echo hi'])
      expect(result).toEqual({
        action: 'rewrite',
        argv: ['node', '/x/dist/cli.js', 'run', '--shell', '--', 'bash', '-c', 'echo hi'],
      })
    })

    it('enters interactive mode with APES_SHELL_MODE=1 and no args', () => {
      const result = rewriteApeShellArgs(['node', '/x/dist/cli.js'])
      expect(result).toEqual({ action: 'interactive' })
    })

    it('returns null when APES_SHELL_MODE is unset and argv does not match', () => {
      delete process.env.APES_SHELL_MODE
      const result = rewriteApeShellArgs(['node', '/x/dist/cli.js', '-c', 'echo hi'])
      expect(result).toBeNull()
    })
  })
})
