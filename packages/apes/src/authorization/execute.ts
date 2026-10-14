import { execFileSync, spawnSync } from 'node:child_process'
import type { StdioOptions } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { CliExit } from '../errors.js'
import type { ProgramCall } from './program.js'

/**
 * Re-checks the program file right before it runs: it must still be a regular file with the authorized hash (the
 * one the verified command token names), so a file replaced after the authorization is refused.
 */
export function assertAuthorizedFile(call: ProgramCall): void {
  if (!statSync(call.program.path).isFile()) throw new Error(`${call.program.path} is not a regular file; nothing was executed`)
  const sha256 = createHash('sha256').update(readFileSync(call.program.path)).digest('hex')
  if (sha256 !== call.program.sha256) throw new Error(`${call.program.path} changed after it was authorized; nothing was executed`)
}

/**
 * Runs the authorized program file itself (never a PATH lookup again) with exactly the authorized arguments. A
 * non-zero exit of the program becomes the exit code of apes. The shell-mode markers are removed so a nested
 * `apes` started by the program runs as a normal CLI.
 */
export function executeProgramCall(call: ProgramCall, stdio: StdioOptions = 'inherit'): void {
  assertAuthorizedFile(call)
  const { APES_SHELL_WRAPPER: _wrapperMarker, APES_SHELL_MODE: _modeMarker, ...env } = process.env
  try {
    execFileSync(call.program.path, call.argv, { stdio, env })
  }
  catch (error) {
    const status = (error as { status?: number | null }).status
    if (typeof status === 'number') throw new CliExit(status || 1)
    throw error
  }
}

export interface CapturedRun {
  exitCode: number
  stdout: string
  stderr: string
}

/** Like `executeProgramCall`, but returns the output instead of handing over the terminal (MCP tool calls). */
export function captureProgramCall(call: ProgramCall): CapturedRun {
  assertAuthorizedFile(call)
  const { APES_SHELL_WRAPPER: _wrapperMarker, APES_SHELL_MODE: _modeMarker, ...env } = process.env
  const result = spawnSync(call.program.path, call.argv, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], env })
  if (result.error) throw result.error
  return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
}
