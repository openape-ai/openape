// Per-agent configuration for prompt-injection detector (#463).
// Reads threshold settings from ~/.openape/agent/agent.json.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const AGENT_CONFIG_PATH = join(homedir(), '.openape', 'agent', 'agent.json')

export interface InjectionConfig {
  /** Threshold for non-owner senders (default: 0.7). */
  threshold?: number
  /** Threshold for owner senders (default: 0.95). */
  ownerThreshold?: number
}

/**
 * Read injection detection config from agent.json.
 * Returns defaults if file doesn't exist or config is missing.
 */
export function readInjectionConfig(): InjectionConfig {
  const defaults: InjectionConfig = {
    threshold: 0.7,
    ownerThreshold: 0.95,
  }

  if (!existsSync(AGENT_CONFIG_PATH)) {
    return defaults
  }

  try {
    const content = readFileSync(AGENT_CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(content) as {
      injectionDetector?: {
        threshold?: number
        ownerThreshold?: number
      }
    }

    const config = parsed.injectionDetector
    if (!config) {
      return defaults
    }

    return {
      threshold: typeof config.threshold === 'number' ? config.threshold : defaults.threshold,
      ownerThreshold: typeof config.ownerThreshold === 'number' ? config.ownerThreshold : defaults.ownerThreshold,
    }
  }
  catch (err) {
    // Log error but return defaults
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`[prompt-injection-detector] Failed to read config: ${errorMsg}. Using defaults.`)
    return defaults
  }
}
