import { describe, expect, it } from 'vitest'
import {
  authFileFor,
  DEFAULT_APE_SHELL_PATH,
  DEFAULT_WAIT_TIMEOUT_MS,
  GateConfigError,
  readGateConfig,
} from '../src/config.js'

const MINIMAL = { agents: { 'delta-mind': '/homes/dm' } }

describe('readGateConfig', () => {
  it('fills in defaults for everything but the identity map', () => {
    const cfg = readGateConfig(MINIMAL)
    expect(cfg.apeShellPath).toBe(DEFAULT_APE_SHELL_PATH)
    expect(cfg.waitTimeoutMs).toBe(DEFAULT_WAIT_TIMEOUT_MS)
  })

  // An empty map would make every agent unmapped, and unmapped means blocked.
  // Failing at config time says so out loud instead of at the first tool call.
  it('rejects a config with no agents', () => {
    expect(() => readGateConfig({ agents: {} })).toThrow(GateConfigError)
    expect(() => readGateConfig({})).toThrow(GateConfigError)
  })

  it('rejects a non-string auth home', () => {
    expect(() => readGateConfig({ agents: { a: 42 } })).toThrow(GateConfigError)
    expect(() => readGateConfig({ agents: { a: '' } })).toThrow(GateConfigError)
  })

  it('rejects a non-positive wait timeout', () => {
    expect(() => readGateConfig({ ...MINIMAL, waitTimeoutMs: 0 })).toThrow(GateConfigError)
    expect(() => readGateConfig({ ...MINIMAL, waitTimeoutMs: 'soon' })).toThrow(GateConfigError)
  })
})

describe('authFileFor', () => {
  // Config stores the auth *home* so cli-auth (which appends .config/apes
  // itself) and the ape-shell path can read one and the same setting.
  it('appends the apes config path to the auth home', () => {
    expect(authFileFor(readGateConfig(MINIMAL), 'delta-mind')).toBe('/homes/dm/.config/apes/auth.json')
  })

  it('returns undefined for an unmapped agent', () => {
    expect(authFileFor(readGateConfig(MINIMAL), 'stranger')).toBeUndefined()
  })
})
