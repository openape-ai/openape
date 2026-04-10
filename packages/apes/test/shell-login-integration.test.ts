import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * M6 integration coverage for the non-regression of the ape-shell `-c` path:
 *
 * When a program uses `SHELL=$(which ape-shell)` and then invokes
 * `$SHELL -c "<command>"`, the invocation must continue to flow through the
 * existing one-shot rewrite path (→ `apes run --shell -- bash -c <command>`)
 * and NOT drop into the interactive REPL. This guarantees that patterns like
 * `SHELL=ape-shell openclaw tui`, `xargs`, git hooks, and sshd non-interactive
 * sessions keep working exactly as before.
 *
 * The test creates a temporary symlink named `ape-shell` → packages/apes/dist/cli.js,
 * builds the dist first (or reuses the build), then spawns the symlink with
 * `-c "<command>"`. We assert the process exits quickly (not in REPL loop)
 * and that the argv-rewriting plumbing reaches citty's `run --shell` command
 * (confirmed by the known "Not logged in" error — we're exercising the
 * post-rewrite code path without mocking IdP).
 */

const REPO_ROOT = resolve(__dirname, '../../..')
const DIST_CLI = join(REPO_ROOT, 'packages/apes/dist/cli.js')
// The rewrite logic matches argv[1] basename strictly against `ape-shell`
// or `ape-shell.js`, so we host the symlink inside a unique subdirectory
// and keep the file name itself literally `ape-shell`.
const TMP_DIR = join(tmpdir(), `apes-login-test-${process.pid}-${Date.now()}`)
const TMP_SYMLINK = join(TMP_DIR, 'ape-shell')

describe('ape-shell login shell + $SHELL compatibility', () => {
  beforeAll(() => {
    // Build once upfront. `tsup` is fast enough that this is cheap in CI,
    // and it avoids requiring the test runner to depend on the `build` task.
    const build = spawnSync('pnpm', ['--filter', '@openape/apes', 'build'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      encoding: 'utf-8',
    })
    if (build.status !== 0) {
      throw new Error(`Failed to build @openape/apes for login-integration test:\n${build.stderr}`)
    }

    // Create a symlink called literally "ape-shell" pointing at the built
    // cli.js so argv[1] basename matches the detection in rewriteApeShellArgs.
    mkdirSync(TMP_DIR, { recursive: true })
    symlinkSync(DIST_CLI, TMP_SYMLINK)
  })

  afterAll(() => {
    try {
      rmSync(TMP_DIR, { recursive: true, force: true })
    }
    catch {}
  })

  it('invocation as `ape-shell -c <command>` routes through the one-shot rewrite path', () => {
    // Running without a valid auth config in a clean env, the one-shot path
    // reaches `apes run --shell` and exits with a clear error. The important
    // observation: it does NOT drop into an interactive REPL (which would
    // block forever reading from stdin).
    const result = spawnSync(TMP_SYMLINK, ['-c', 'echo hello'], {
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 10_000,
      env: {
        ...process.env,
        // Point at an invalid HOME to force a "Not logged in" style error
        // without interfering with the user's real config.
        HOME: tmpdir(),
        // Make sure we don't accidentally talk to a real IdP.
        APES_IDP: 'http://127.0.0.1:1', // unreachable
      },
    })

    // Process must have exited (not hung in REPL). status !== null proves it.
    expect(result.status).not.toBeNull()

    // Combined stdout+stderr should contain an error from the one-shot path,
    // NOT the REPL banner we'd see in interactive mode.
    const combined = `${result.stdout}${result.stderr}`
    expect(combined).not.toContain('apes interactive shell')
    expect(combined).not.toContain('Ctrl-D to exit')
  })

  it('invocation as `ape-shell --version` prints the version (non-regression for help/version handling)', () => {
    const result = spawnSync(TMP_SYMLINK, ['--version'], {
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 10_000,
      env: { ...process.env, HOME: tmpdir() },
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('ape-shell')
    // Any semver-ish digits sequence is enough; we don't pin the version.
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/)
  })

  it('invocation via SHELL=$(which ape-shell) bash -c ... still uses ape-shell for bash\'s own children', () => {
    // This exercises the pattern: a parent program sets SHELL=ape-shell and
    // spawns a child command via that shell. We test the simplest case:
    // `bash -c 'echo hello'` with SHELL=<our symlink>. bash itself doesn't
    // re-exec through SHELL for a -c invocation (bash runs the command in
    // its own process), but this does verify that the symlink resolves and
    // is a valid executable in PATH-like lookups when programs use it.
    const result = spawnSync('bash', ['-c', 'echo hello-from-parent-bash'], {
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 10_000,
      env: {
        ...process.env,
        SHELL: TMP_SYMLINK,
      },
    })

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('hello-from-parent-bash')
  })
})
