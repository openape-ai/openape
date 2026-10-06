import { join } from 'node:path'

/**
 * Resolved plugin configuration. OpenClaw hands the raw object to every hook
 * as `event.context.pluginConfig`; `readGateConfig` turns it into this.
 */
export interface GateConfig {
  /** OpenClaw agent id → that agent's apes auth home. */
  agents: Record<string, string>
  /** Absolute path to the ape-shell binary. */
  apeShellPath: string
  /** How long to wait for a grant decision before failing closed. */
  waitTimeoutMs: number
  /**
   * Where the human is asked.
   *
   * `idp` (default) polls the grant until it is decided, so the decision can
   * come from any surface the IdP already reaches — push, mail, Telegram. It
   * is the only option that works for unattended agents.
   *
   * `openclaw` returns `requireApproval` so the prompt appears in the session
   * itself. That is nicer when someone is watching, but OpenClaw rejects the
   * call outright with "Plugin approval unavailable (no approval route)" when
   * the session has no interactive channel — which is the normal case for a
   * background operator.
   */
  approvalSurface: 'idp' | 'openclaw'
}

export const DEFAULT_APE_SHELL_PATH = '/usr/local/bin/ape-shell'

/**
 * Ten minutes, matching the largest budget OpenClaw accepts for a single
 * `before_tool_call` handler. The baseline measurement that motivated this
 * package saw a human approval land 68 s after the request while the exec
 * tool had already been killed at ~60 s, so the wait has to outlast a person
 * walking to their phone.
 */
export const DEFAULT_WAIT_TIMEOUT_MS = 600_000

export class GateConfigError extends Error {}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GateConfigError(`openape-grant-gate: \`${field}\` must be an object`)
  }
  return value as Record<string, unknown>
}

/**
 * Validate the operator-supplied plugin config. Every failure throws: a gate
 * that silently falls back to a default identity map would hand an agent the
 * wrong identity, which is worse than not starting.
 */
export function readGateConfig(raw: unknown): GateConfig {
  const cfg = asRecord(raw ?? {}, 'pluginConfig')
  const agentsRaw = asRecord(cfg.agents, 'agents')

  const agents: Record<string, string> = {}
  for (const [agentId, authHome] of Object.entries(agentsRaw)) {
    if (typeof authHome !== 'string' || authHome.length === 0) {
      throw new GateConfigError(`openape-grant-gate: agents.${agentId} must be a non-empty string`)
    }
    agents[agentId] = authHome
  }
  if (Object.keys(agents).length === 0) {
    throw new GateConfigError('openape-grant-gate: `agents` must map at least one agent id to an auth home')
  }

  const apeShellPath = cfg.apeShellPath ?? DEFAULT_APE_SHELL_PATH
  if (typeof apeShellPath !== 'string' || apeShellPath.length === 0) {
    throw new GateConfigError('openape-grant-gate: `apeShellPath` must be a non-empty string')
  }

  const waitTimeoutMs = cfg.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
  if (typeof waitTimeoutMs !== 'number' || !Number.isFinite(waitTimeoutMs) || waitTimeoutMs <= 0) {
    throw new GateConfigError('openape-grant-gate: `waitTimeoutMs` must be a positive number')
  }

  const approvalSurface = cfg.approvalSurface ?? 'idp'
  if (approvalSurface !== 'idp' && approvalSurface !== 'openclaw') {
    throw new GateConfigError('openape-grant-gate: `approvalSurface` must be "idp" or "openclaw"')
  }

  return { agents, apeShellPath, waitTimeoutMs, approvalSurface }
}

/**
 * The apes auth file for an agent. Config stores the auth *home* rather than
 * the file path because `@openape/cli-auth` takes a home and appends
 * `.config/apes` itself — keeping the home lets both the shell-wrapping path
 * and the direct API path read the same config value.
 */
export function authFileFor(config: GateConfig, agentId: string): string | undefined {
  const home = config.agents[agentId]
  return home === undefined ? undefined : join(home, '.config', 'apes', 'auth.json')
}
