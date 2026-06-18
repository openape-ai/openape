import type { BridgeConfig } from '@openape/ape-agent'
import type { AgentEntry } from './registry'
import { readConfig } from '@openape/ape-agent'

/**
 * Resolve the {@link BridgeConfig} for one agent from the nest's env, the
 * in-process parity of what the pm2 supervisor forwarded per child: the shared
 * `APE_CHAT_BRIDGE_*` / `OPENAPE_TROOP_URL` keys come from the nest env, while
 * the per-agent `bridge.model` override from the registry entry takes precedence
 * over the shared `APE_CHAT_BRIDGE_MODEL` (mirroring the pm2 path passing
 * `br.model` as `APE_SERVICE_MODEL`).
 *
 * The env is injected (not read from `process.env` directly) so the SessionHost
 * can resolve one config per agent without mutating the daemon's global env, and
 * so the parsing/validation stays the bridge's own {@link readConfig} — no
 * second copy of the rules to drift.
 */
export function resolveBridgeConfig(
  entry: AgentEntry,
  env: NodeJS.ProcessEnv,
): BridgeConfig {
  const model = entry.bridge?.model
  const merged = model ? { ...env, APE_CHAT_BRIDGE_MODEL: model } : env
  return readConfig(merged)
}
