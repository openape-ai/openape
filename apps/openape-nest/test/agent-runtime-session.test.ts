import type { BridgeConfig } from '@openape/ape-agent'
import { describe, expect, it } from 'vitest'
import type { AgentEntry } from '../src/lib/registry'
import { SessionHost } from '../src/lib/session-host'
import { createAgentRuntimeSession } from '../src/lib/agent-runtime-session'

function entry(name: string): AgentEntry {
  return { name, uid: 1000, home: `/home/${name}`, email: `${name}@example.test`, registeredAt: 0 }
}

const ctx = {
  ownerEmail: 'owner@example.test',
  bridgeConfig: {} as BridgeConfig,
}

describe('createAgentRuntimeSession', () => {
  it('constructs a real AgentSession and logs its identity on start', async () => {
    const lines: string[] = []
    const session = createAgentRuntimeSession(entry('backend'), ctx, line => lines.push(line))

    await session.start()

    expect(session.name).toBe('backend')
    expect(lines).toContain(
      'agent-runtime: + backend hosting backend@example.test (owner owner@example.test)',
    )
  })

  it('logs on stop', async () => {
    const lines: string[] = []
    const session = createAgentRuntimeSession(entry('qa'), ctx, line => lines.push(line))

    await session.stop()

    expect(lines).toContain('agent-runtime: - qa stopped')
  })

  it('plugs into SessionHost as the injected session factory', async () => {
    const lines: string[] = []
    const host = new SessionHost({
      log: line => lines.push(line),
      createSession: e => createAgentRuntimeSession(e, ctx, line => lines.push(line)),
    })

    await host.reconcile([entry('backend'), entry('qa')])

    expect(host.status().hosted).toEqual(['backend', 'qa'])
    expect(lines).toContain(
      'agent-runtime: + backend hosting backend@example.test (owner owner@example.test)',
    )
  })
})
