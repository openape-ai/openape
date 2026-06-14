import { describe, expect, it } from 'vitest'
import type { AgentEntry } from '../src/lib/registry'
import type { HostedSession } from '../src/lib/session-host'
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
  it('starts a session for every agent on the first reconcile', async () => {
    const { host, lines } = makeHost()
    await host.reconcile([entry('a'), entry('b')])
    expect(lines).toContain('session-host: + a (started)')
    expect(lines).toContain('session-host: + b (started)')
    expect(lines).toContain('session-host: now hosting 2 agent(s)')
  })

  it('stops a session when an agent disappears from the registry', async () => {
    const { host, lines } = makeHost()
    await host.reconcile([entry('a'), entry('b')])
    lines.length = 0
    await host.reconcile([entry('a')])
    expect(lines).toContain('session-host: - b (gone from registry, stopped)')
    expect(lines.some(line => line.startsWith('session-host: + '))).toBe(false)
  })

  it('starts a session when a new agent appears alongside existing ones', async () => {
    const { host, lines } = makeHost()
    await host.reconcile([entry('a')])
    lines.length = 0
    await host.reconcile([entry('a'), entry('b')])
    expect(lines).toContain('session-host: + b (started)')
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

describe('sessionHost.reconcile error isolation', () => {
  function lifecycleSession(events: string[], opts: { throwStartOn?: string, throwStopOn?: string } = {}) {
    return (e: AgentEntry): HostedSession => ({
      name: e.name,
      async start() {
        if (opts.throwStartOn === e.name)
          throw new Error(`startboom:${e.name}`)
        events.push(`start:${e.name}`)
      },
      async stop() {
        if (opts.throwStopOn === e.name)
          throw new Error(`stopboom:${e.name}`)
        events.push(`stop:${e.name}`)
      },
    })
  }

  it('isolates a throwing start so the other agents still start', async () => {
    const events: string[] = []
    const lines: string[] = []
    const host = new SessionHost({ log: line => lines.push(line), createSession: lifecycleSession(events, { throwStartOn: 'a' }) })
    await host.reconcile([entry('a'), entry('b')])
    expect(events).toEqual(['start:b'])
    expect(lines).toContain('session-host: ! a start failed: startboom:a')
    expect(lines).toContain('session-host: + b (started)')
  })

  it('retries a failed start on the next reconcile', async () => {
    const events: string[] = []
    let failNext = true
    const factory = (e: AgentEntry): HostedSession => ({
      name: e.name,
      async start() {
        if (e.name === 'a' && failNext) {
          failNext = false
          throw new Error('startboom:a')
        }
        events.push(`start:${e.name}`)
      },
      async stop() {},
    })
    const host = new SessionHost({ log: () => {}, createSession: factory })
    await host.reconcile([entry('a')]) // start throws → a stays absent
    expect(events).toEqual([])
    await host.reconcile([entry('a')]) // a still desired but not live → retried
    expect(events).toEqual(['start:a'])
  })

  it('isolates a throwing stop and still drops the agent from the live set', async () => {
    const events: string[] = []
    const lines: string[] = []
    const host = new SessionHost({ log: line => lines.push(line), createSession: lifecycleSession(events, { throwStopOn: 'a' }) })
    await host.reconcile([entry('a'), entry('b')])
    events.length = 0
    lines.length = 0
    await host.reconcile([]) // both leave; a's stop throws
    expect(events).toEqual(['stop:b'])
    expect(lines).toContain('session-host: ! a stop failed: stopboom:a')
    // a was dropped despite the failed stop: a later reconcile re-adds it as new.
    await host.reconcile([entry('a')])
    expect(events).toContain('start:a')
  })
})

describe('sessionHost lifecycle seam', () => {
  it('starts and stops the injected session exactly at the transitions', async () => {
    const events: string[] = []
    function fakeSession(e: AgentEntry): HostedSession {
      return {
        name: e.name,
        async start() {
          events.push(`start:${e.name}`)
        },
        async stop() {
          events.push(`stop:${e.name}`)
        },
      }
    }
    const host = new SessionHost({ log: () => {}, createSession: fakeSession })

    await host.reconcile([entry('a')])
    await host.reconcile([entry('a')]) // no-op: no extra start
    await host.reconcile([]) // a leaves: stop

    expect(events).toEqual(['start:a', 'stop:a'])
  })
})

describe('sessionHost.reconcile config changes', () => {
  function configured(name: string, model: string): AgentEntry {
    return { ...entry(name), bridge: { model } }
  }

  function recordingSession(events: string[]) {
    return (e: AgentEntry): HostedSession => ({
      name: e.name,
      async start() {
        events.push(`start:${e.name}:${e.bridge?.model ?? '-'}`)
      },
      async stop() {
        events.push(`stop:${e.name}`)
      },
    })
  }

  it('restarts a session when its registry config changes', async () => {
    const events: string[] = []
    const lines: string[] = []
    const host = new SessionHost({ log: line => lines.push(line), createSession: recordingSession(events) })
    await host.reconcile([configured('a', 'gpt-5.4')])
    events.length = 0
    lines.length = 0
    await host.reconcile([configured('a', 'gpt-5.5')])
    // Old session stops before the new one starts, and the new one carries the new config.
    expect(events).toEqual(['stop:a', 'start:a:gpt-5.5'])
    expect(lines).toContain('session-host: ~ a (config changed, restarted)')
  })

  it('does not restart a session when the config is unchanged', async () => {
    const events: string[] = []
    const lines: string[] = []
    const host = new SessionHost({ log: line => lines.push(line), createSession: recordingSession(events) })
    await host.reconcile([configured('a', 'gpt-5.4')])
    events.length = 0
    lines.length = 0
    await host.reconcile([configured('a', 'gpt-5.4')])
    expect(events).toEqual([])
    expect(lines).toContain('session-host: reconcile no-op (1 agent(s))')
  })

  it('ignores registeredAt when deciding whether to restart', async () => {
    const events: string[] = []
    const host = new SessionHost({ log: () => {}, createSession: recordingSession(events) })
    await host.reconcile([{ ...configured('a', 'gpt-5.4'), registeredAt: 1 }])
    events.length = 0
    await host.reconcile([{ ...configured('a', 'gpt-5.4'), registeredAt: 999 }])
    expect(events).toEqual([])
  })
})

describe('sessionHost.tickAll', () => {
  function tickingSession(ticks: string[], opts: { throwOn?: string } = {}) {
    return (e: AgentEntry): HostedSession => ({
      name: e.name,
      async start() {},
      async stop() {},
      async tick() {
        if (opts.throwOn === e.name)
          throw new Error(`boom:${e.name}`)
        ticks.push(e.name)
      },
    })
  }

  it('ticks every live session once', async () => {
    const ticks: string[] = []
    const host = new SessionHost({ log: () => {}, createSession: tickingSession(ticks) })
    await host.reconcile([entry('a'), entry('b')])
    await host.tickAll()
    expect(ticks.sort()).toEqual(['a', 'b'])
  })

  it('does not tick a session that left the registry', async () => {
    const ticks: string[] = []
    const host = new SessionHost({ log: () => {}, createSession: tickingSession(ticks) })
    await host.reconcile([entry('a'), entry('b')])
    await host.reconcile([entry('a')])
    await host.tickAll()
    expect(ticks).toEqual(['a'])
  })

  it('isolates a throwing tick so the other sessions still advance', async () => {
    const ticks: string[] = []
    const lines: string[] = []
    const host = new SessionHost({ log: line => lines.push(line), createSession: tickingSession(ticks, { throwOn: 'a' }) })
    await host.reconcile([entry('a'), entry('b')])
    await host.tickAll()
    expect(ticks).toEqual(['b'])
    expect(lines).toContain('session-host: ! a tick failed: boom:a')
  })

  it('is a no-op for placeholder sessions without a tick', async () => {
    const { host } = makeHost()
    await host.reconcile([entry('a')])
    await expect(host.tickAll()).resolves.toBeUndefined()
  })
})

describe('sessionHost.stopAll', () => {
  function stoppingSession(events: string[], opts: { throwOn?: string } = {}) {
    return (e: AgentEntry): HostedSession => ({
      name: e.name,
      async start() {},
      async stop() {
        if (opts.throwOn === e.name)
          throw new Error(`boom:${e.name}`)
        events.push(`stop:${e.name}`)
      },
    })
  }

  it('stops every live session and reports the count', async () => {
    const events: string[] = []
    const lines: string[] = []
    const host = new SessionHost({ log: line => lines.push(line), createSession: stoppingSession(events) })
    await host.reconcile([entry('a'), entry('b')])
    await host.stopAll()
    expect(events.sort()).toEqual(['stop:a', 'stop:b'])
    expect(lines).toContain('session-host: stopped all 2 session(s)')
  })

  it('isolates a throwing stop so the other sessions still stop', async () => {
    const events: string[] = []
    const lines: string[] = []
    const host = new SessionHost({ log: line => lines.push(line), createSession: stoppingSession(events, { throwOn: 'a' }) })
    await host.reconcile([entry('a'), entry('b')])
    await host.stopAll()
    expect(events).toEqual(['stop:b'])
    expect(lines).toContain('session-host: ! a stop failed: boom:a')
  })

  it('clears the live set so a session is not stopped twice', async () => {
    const events: string[] = []
    const host = new SessionHost({ log: () => {}, createSession: stoppingSession(events) })
    await host.reconcile([entry('a')])
    await host.stopAll()
    await host.stopAll()
    expect(events).toEqual(['stop:a'])
  })
})
