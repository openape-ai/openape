import { describe, expect, it } from 'vitest'
import type { AgentEntry } from '../src/lib/registry'
import { SessionHost } from '../src/lib/session-host'

function entry(name: string): AgentEntry {
  return { name, uid: 1000, home: `/home/${name}`, email: `${name}@example.test`, registeredAt: 0 }
}

function makeHost() {
  const lines: string[] = []
  const host = new SessionHost({ log: line => lines.push(line) })
  return { host, lines }
}

describe('sessionHost.reconcile', () => {
  it('logs an add for every agent on the first reconcile', async () => {
    const { host, lines } = makeHost()
    await host.reconcile([entry('a'), entry('b')])
    expect(lines).toContain('session-host: + a (start pending)')
    expect(lines).toContain('session-host: + b (start pending)')
    expect(lines).toContain('session-host: now hosting 2 agent(s)')
  })

  it('logs a removal when an agent disappears from the registry', async () => {
    const { host, lines } = makeHost()
    await host.reconcile([entry('a'), entry('b')])
    lines.length = 0
    await host.reconcile([entry('a')])
    expect(lines).toContain('session-host: - b (gone from registry, stop pending)')
    expect(lines.some(line => line.startsWith('session-host: + '))).toBe(false)
  })

  it('logs an add when a new agent appears alongside existing ones', async () => {
    const { host, lines } = makeHost()
    await host.reconcile([entry('a')])
    lines.length = 0
    await host.reconcile([entry('a'), entry('b')])
    expect(lines).toContain('session-host: + b (start pending)')
    expect(lines.some(line => line.startsWith('session-host: - '))).toBe(false)
  })

  it('is a no-op when the desired set is unchanged', async () => {
    const { host, lines } = makeHost()
    await host.reconcile([entry('a')])
    lines.length = 0
    await host.reconcile([entry('a')])
    expect(lines).toContain('session-host: reconcile no-op (1 agent(s))')
  })
})
