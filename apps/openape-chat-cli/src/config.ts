import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const DEFAULT_ENDPOINT = 'https://chat.openape.ai'

interface CliState {
  endpoint?: string
  defaultRoomId?: string
}

function configPath(): string {
  return join(homedir(), '.openape', 'auth-chat.json')
}

function loadState(): CliState {
  const path = configPath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CliState
  }
  catch {
    return {}
  }
}

function saveState(next: CliState): void {
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2), { mode: 0o600 })
}

export function getEndpoint(override?: string | null): string {
  if (override) return override.replace(/\/$/, '')
  const env = process.env.APE_CHAT_ENDPOINT
  if (env) return env.replace(/\/$/, '')
  const stored = loadState().endpoint
  if (stored) return stored.replace(/\/$/, '')
  return DEFAULT_ENDPOINT
}

export function setEndpoint(endpoint: string): void {
  saveState({ ...loadState(), endpoint: endpoint.replace(/\/$/, '') })
}

export function getDefaultRoomId(override?: string | null): string | undefined {
  if (override) return override
  const env = process.env.APE_CHAT_ROOM
  if (env) return env
  return loadState().defaultRoomId
}

export function setDefaultRoomId(roomId: string | null): void {
  const state = loadState()
  if (roomId) state.defaultRoomId = roomId
  else delete state.defaultRoomId
  saveState(state)
}
