import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Black-box harness for the ape-* CLIs, shared by the per-package test suites
 * (ape-tasks, ape-plans, ape-pr, ape-testruns, ape-timetrack, ape-troop).
 *
 * Spawns the built `dist` bundle as a real subprocess — no imports of CLI
 * internals — and isolates it from the developer's machine:
 *
 * - HOME / XDG_CONFIG_HOME / OPENAPE_CLI_AUTH_HOME point at a throwaway temp
 *   dir, so the real `~/.config/apes/auth.json` and `~/.openape/*` state is
 *   never read or written.
 * - Every known endpoint env override points at an unroutable address, so a
 *   test can never reach a live SP even if a code path tries. (Without auth
 *   the CLIs fail in `getAuthorizedBearer` before any HTTP request.)
 * - Every spawn carries a hard timeout, so a hanging command fails the test
 *   instead of blocking the run.
 */

const REPO_ROOT = resolve(import.meta.dirname, '../../..')
const UNROUTABLE = 'http://127.0.0.1:9'
const SPAWN_TIMEOUT_MS = 15_000

export interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

export interface CliHarness {
  /** Run the CLI with the given argv, fully isolated. Throws on timeout. */
  run: (...args: string[]) => CliResult
  /** Remove the throwaway HOME. Call from `afterAll`. */
  dispose: () => void
}

/** Strip ANSI escapes so assertions see the plain help/error text. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*m/g, '')
}

/**
 * `packageDir` is the CLI package root (pass `join(import.meta.dirname, '..')`
 * from a test under `<pkg>/test/`), `binFile` the built entry relative to it
 * (e.g. `dist/cli.mjs`).
 */
export function createCliHarness(packageDir: string, binFile: string): CliHarness {
  const binPath = join(packageDir, binFile)
  const home = mkdtempSync(join(tmpdir(), 'ape-cli-test-'))
  let built = existsSync(binPath)

  // Under `turbo run test` the `^build` dependency builds the workspace deps
  // but not the package's own dist. Mirror the repo pattern from
  // packages/apes/test/shell-login-integration.test.ts: reuse an existing
  // dist, build as a fallback (`--filter <name>...` includes the deps).
  function ensureBuilt(): void {
    if (built) return
    const { name } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf-8')) as { name: string }
    const result = spawnSync('pnpm', ['--filter', `${name}...`, 'build'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: 120_000,
    })
    if (result.status !== 0) {
      throw new Error(`Failed to build ${name} for CLI black-box tests:\n${result.stderr}`)
    }
    built = true
  }

  function run(...args: string[]): CliResult {
    ensureBuilt()
    // citty renders help/usage through consola, which silences itself when it
    // inherits vitest's NODE_ENV=test / TEST markers — strip them so the CLI
    // behaves exactly as it would for a user.
    const env = { ...process.env }
    delete env.NODE_ENV
    delete env.TEST
    delete env.VITEST
    const result = spawnSync(process.execPath, [binPath, ...args], {
      encoding: 'utf-8',
      timeout: SPAWN_TIMEOUT_MS,
      env: {
        ...env,
        HOME: home,
        XDG_CONFIG_HOME: join(home, '.config'),
        OPENAPE_CLI_AUTH_HOME: join(home, '.config', 'apes'),
        APES_IDP: UNROUTABLE,
        APE_TASKS_ENDPOINT: UNROUTABLE,
        APE_PLANS_ENDPOINT: UNROUTABLE,
        APE_PR_ENDPOINT: UNROUTABLE,
        APE_TESTRUNS_ENDPOINT: UNROUTABLE,
        APE_TIMETRACK_ENDPOINT: UNROUTABLE,
        OPENAPE_TROOP_URL: UNROUTABLE,
        NO_COLOR: '1',
      },
    })
    if (result.error) {
      throw new Error(`CLI spawn failed (${binPath} ${args.join(' ')}): ${result.error.message}`)
    }
    return {
      status: result.status,
      stdout: stripAnsi(result.stdout),
      stderr: stripAnsi(result.stderr),
    }
  }

  return {
    run,
    dispose: () => rmSync(home, { recursive: true, force: true }),
  }
}
