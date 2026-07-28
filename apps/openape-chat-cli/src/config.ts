/**
 * Chat-specific config helpers.
 *
 * Generic endpoint resolution + state I/O now live in @openape/cli-auth
 * via createSpClient (see src/client.ts). This file provides the
 * chat-app-specific helpers for default room / thread selection that
 * commands import unchanged.
 */
import { loadConfig, resolveEndpoint, saveConfig } from './client'
import type { ChatState } from './client'

// Re-export getEndpoint under the name the rest of the codebase uses.
export { resolveEndpoint as getEndpoint }

export function getDefaultRoomId(override?: string | null): string | undefined {
  if (override) return override
  const env = process.env.APE_CHAT_ROOM
  if (env) return env
  return loadConfig().defaultRoomId
}

export function setDefaultRoomId(roomId: string | null): void {
  const state = loadConfig()
  if (roomId) state.defaultRoomId = roomId
  else delete state.defaultRoomId
  saveConfig(state)
}

export function getDefaultThreadId(roomId: string, override?: string | null): string | undefined {
  if (override) return override
  const env = process.env.APE_CHAT_THREAD
  if (env) return env
  return (loadConfig() as ChatState).defaultThreadByRoom?.[roomId]
}

export function setDefaultThreadId(roomId: string, threadId: string | null): void {
  const state = loadConfig() as ChatState
  const map = { ...(state.defaultThreadByRoom ?? {}) }
  if (threadId) map[roomId] = threadId
  else delete map[roomId]
  state.defaultThreadByRoom = map
  saveConfig(state)
}
