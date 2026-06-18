import type { AgentEntry } from '../src/lib/registry'
import { describe, expect, it } from 'vitest'
import { isDaemonRuntime, sessionHostAgents } from '../src/lib/runtime-routing'

function agent(name: string, runtimeType?: 'bridge' | 'openclaw'): AgentEntry {
  return { name, uid: 1, home: `/home/${name}`, email: `${name}@id.openape.ai`, registeredAt: 0, runtimeType }
}

describe('isDaemonRuntime', () => {
  it('treats absent and "bridge" as the pm2-supervised daemon', () => {
    expect(isDaemonRuntime(agent('a'))).toBe(true)
    expect(isDaemonRuntime(agent('b', 'bridge'))).toBe(true)
  })
  it('treats openclaw as non-daemon (in-process)', () => {
    expect(isDaemonRuntime(agent('c', 'openclaw'))).toBe(false)
  })
})

describe('sessionHostAgents', () => {
  const all = [agent('bridge1'), agent('bridge2', 'bridge'), agent('ocl', 'openclaw')]

  it('hosts only non-daemon (openclaw) agents on the pm2 path', () => {
    expect(sessionHostAgents(all, false).map(a => a.name)).toEqual(['ocl'])
  })
  it('hosts every agent when in-process', () => {
    expect(sessionHostAgents(all, true).map(a => a.name)).toEqual(['bridge1', 'bridge2', 'ocl'])
  })
})
