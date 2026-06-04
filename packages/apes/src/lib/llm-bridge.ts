// Helpers for `apes agents spawn`. The chat-bridge is a daemon
// that runs as the agent user, listens to chat.openape.ai, and forwards
// messages to a local LLM CLI (pi). It needs access to a local litellm
// proxy — set up out-of-band by the spawning user (today: hand-crafted
// at ~/litellm/.env).

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface BridgeConfig {
  /** Where the bridge will POST messages — http://host:port/v1 */
  baseUrl: string
  /** Master key for the litellm proxy */
  apiKey: string
  /**
   * Model the bridge sends in every chat-completion request. Optional:
   * if undefined, the bridge falls back to its built-in default
   * (`claude-haiku-4-5`). Set this when the upstream proxy doesn't
   * route that model — e.g. a LiteLLM proxy fronting only ChatGPT
   * subscription needs `gpt-5.4` or the proxy 404s every request.
   */
  model?: string
}

/**
 * Read defaults from `~/litellm/.env` (the hand-crafted location patrick
 * uses today). Returns null if no file or no key found.
 */
export function readLitellmEnv(envPath: string = join(homedir(), 'litellm', '.env')): { apiKey?: string, baseUrl?: string, model?: string } | null {
  if (!existsSync(envPath)) return null
  try {
    const text = readFileSync(envPath, 'utf8')
    const out: { apiKey?: string, baseUrl?: string, model?: string } = {}
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq < 0) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (key === 'LITELLM_MASTER_KEY' || key === 'LITELLM_API_KEY') out.apiKey = value
      if (key === 'LITELLM_BASE_URL') out.baseUrl = value
      if (key === 'APE_CHAT_BRIDGE_MODEL') out.model = value
    }
    return out
  }
  catch {
    return null
  }
}
