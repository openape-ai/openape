import { execFileSync, spawnSync } from 'node:child_process'
import type { StdioOptions } from 'node:child_process'
import { CliExit } from '../errors.js'
import type { ProgramCall } from './program.js'

/**
 * Runs the authorized program file itself (never a PATH lookup again) with exactly the authorized arguments. A
 * non-zero exit of the program becomes the exit code of apes. The shell-mode markers are removed so a nested
 * `apes` started by the program runs as a normal CLI.
 */
export function executeProgramCall(call: ProgramCall, stdio: StdioOptions = 'inherit'): void {
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
  const { APES_SHELL_WRAPPER: _wrapperMarker, APES_SHELL_MODE: _modeMarker, ...env } = process.env
  const result = spawnSync(call.program.path, call.argv, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], env })
  if (result.error) throw result.error
  return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
}
