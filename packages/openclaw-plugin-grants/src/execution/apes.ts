import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

export interface ApesConfig {
  enabled: boolean
  binaryPath: string
}

export function detectApes(binaryPath: string = 'apes'): { available: boolean, path: string, version?: string } {
  // Check explicit path first
  if (binaryPath !== 'apes' && existsSync(binaryPath)) {
    return { available: true, path: binaryPath, version: getApesVersion(binaryPath) }
  }

  // Check PATH
  try {
    const result = execFileSync('which', [binaryPath], { encoding: 'utf-8', timeout: 5000 }).trim()
    if (result) {
      return { available: true, path: result, version: getApesVersion(result) }
    }
  }
  catch {
    // not found in PATH
  }

  return { available: false, path: binaryPath }
}

function getApesVersion(binaryPath: string): string | undefined {
  try {
    return execFileSync(binaryPath, ['--version'], { encoding: 'utf-8', timeout: 5000 }).trim()
  }
  catch {
    return undefined
  }
}

export function buildApesArgs(jwt: string, command: string, args: string[]): string[] {
  return ['--grant', jwt, '--', command, ...args]
}
