import type { AgentEntry } from '../src/lib/registry'
import { describe, expect, it } from 'vitest'
import { assertBridgeRuntime, isBridgeRuntime } from '../src/lib/runtime-routing'

function agent(runtimeType?: unknown): AgentEntry {
  return JSON.parse(JSON.stringify({ name: 'legacy', uid: 1, home: '/home/legacy', email: 'legacy@example.test', registeredAt: 0, runtimeType }))
}

describe('bridge runtime eligibility', () => {
  it('accepts existing default and explicit bridge entries', () => {
    for (const runtimeType of [undefined, 'bridge']) {
      expect(isBridgeRuntime(agent(runtimeType))).toBe(true)
      expect(() => assertBridgeRuntime(agent(runtimeType))).not.toThrow()
    }
  })

  it('rejects retired and unknown persisted runtimes instead of starting a bridge', () => {
    for (const runtimeType of ['openclaw', 'unknown']) {
      expect(isBridgeRuntime(agent(runtimeType))).toBe(false)
      expect(() => assertBridgeRuntime(agent(runtimeType))).toThrow('unsupported runtime')
    }
  })
})
