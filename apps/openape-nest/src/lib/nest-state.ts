// Nest-wide state — currently just the fleet pause switch, persisted next to the
// agent registry so a daemon restart preserves it. Per-agent pause lives on the
// AgentEntry (registry.ts); this file holds the one flag that pauses everything.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findAgent, REGISTRY_DIR } from './registry'

interface NestState {
  paused: boolean
}

const NEST_STATE_PATH = join(REGISTRY_DIR, 'nest-state.json')

export function readNestState(): NestState {
  if (!existsSync(NEST_STATE_PATH)) return { paused: false }
  try {
    const parsed = JSON.parse(readFileSync(NEST_STATE_PATH, 'utf8')) as Partial<NestState>
    return { paused: parsed?.paused === true }
  }
  catch {
    return { paused: false }
  }
}

export function setNestPaused(paused: boolean): void {
  mkdirSync(REGISTRY_DIR, { recursive: true })
  writeFileSync(NEST_STATE_PATH, `${JSON.stringify({ paused }, null, 2)}\n`, { mode: 0o660 })
}

/**
 * Whether `name` should run no LLM turns right now — true if the whole nest is
 * paused or this agent is individually paused. Read live at each turn so pause
 * takes effect (and resume reverts) without respawning the agent.
 */
export function isAgentPaused(name: string): boolean {
  if (readNestState().paused) return true
  return findAgent(name)?.paused === true
}
