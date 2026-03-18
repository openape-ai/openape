import type { PluginApi, ToolResult } from '../types.js'

export interface ExecuteOptions {
  command: string
  args: string[]
  jwt?: string
  privileged?: boolean
  apesBinaryPath?: string
  timeout?: number
}

export async function executeCommand(api: PluginApi, options: ExecuteOptions): Promise<ToolResult> {
  const { command, args, jwt, privileged, apesBinaryPath, timeout } = options

  if (privileged && jwt && apesBinaryPath) {
    return executeWithApes(api, { command, args, jwt, binaryPath: apesBinaryPath, timeout })
  }

  return executeDirectly(api, { command, args, timeout })
}

async function executeDirectly(api: PluginApi, options: { command: string, args: string[], timeout?: number }): Promise<ToolResult> {
  try {
    const result = await api.runtime.system.runCommandWithTimeout(
      options.command,
      options.args,
      { timeout: options.timeout ?? 30000 },
    )

    if (result.exitCode !== 0) {
      return {
        success: false,
        output: result.stdout || undefined,
        error: result.stderr || `Command exited with code ${result.exitCode}`,
      }
    }

    return {
      success: true,
      output: result.stdout,
    }
  }
  catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function executeWithApes(api: PluginApi, options: {
  command: string
  args: string[]
  jwt: string
  binaryPath: string
  timeout?: number
}): Promise<ToolResult> {
  try {
    const result = await api.runtime.system.runCommandWithTimeout(
      options.binaryPath,
      ['--grant', options.jwt, '--', options.command, ...options.args],
      { timeout: options.timeout ?? 30000 },
    )

    if (result.exitCode !== 0) {
      return {
        success: false,
        output: result.stdout || undefined,
        error: result.stderr || `apes exited with code ${result.exitCode}`,
      }
    }

    return {
      success: true,
      output: result.stdout,
    }
  }
  catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
