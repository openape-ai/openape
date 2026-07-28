/**
 * Shared SP client instance for chat.openape.ai.
 *
 * Single call-site for createSpClient — all command modules and helpers
 * import from here (via the api/config/output shims) rather than reaching
 * into @openape/cli-auth directly.
 */
import { createSpClient } from '@openape/cli-auth'
import type { SpClientState } from '@openape/cli-auth'

export interface ChatState extends SpClientState {
  endpoint?: string
  defaultRoomId?: string
  /**
   * Per-room active thread. Phase B: rooms can have N threads, and the
   * CLI remembers which thread the user has `ape-chat threads use`d
   * inside each room so subsequent `send`/`list` calls land in the
   * intended thread without forcing a `--thread` flag every time.
   */
  defaultThreadByRoom?: Record<string, string>
}

const chatClient = createSpClient<ChatState>({
  defaultEndpoint: 'https://chat.openape.ai',
  envVar: 'APE_CHAT_ENDPOINT',
  configFile: 'auth-chat.json',
  defaultAud: 'chat.openape.ai',
})

// Convenience re-exports so importers can destructure from this module
// if they prefer; the shim files (api.ts / config.ts / output.ts) do
// the actual re-exporting that keeps existing command imports working.
export const { resolveEndpoint, loadConfig, saveConfig, _request } = chatClient
