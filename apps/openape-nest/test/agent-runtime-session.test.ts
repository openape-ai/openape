import type { BridgeConfig } from '@openape/ape-agent'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentEntry } from '../src/lib/registry'
import { SessionHost } from '../src/lib/session-host'
import { createAgentRuntimeSession, resolveAgentRuntimeContext } from '../src/lib/agent-runtime-session'

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

  it('retains the constructed AgentSession and tears it down on stop', async () => {
    const lines: string[] = []
    const session = createAgentRuntimeSession(entry('qa'), ctx, line => lines.push(line))

    await session.start()
    await session.stop()

    // stop names the identity of the *retained* instance, proving it held the
    // session constructed by start() rather than discarding it.
    expect(lines).toContain('agent-runtime: - qa stopped qa@example.test (owner owner@example.test)')
  })

  it('stop is a no-op when nothing was started', async () => {
    const lines: string[] = []
    const session = createAgentRuntimeSession(entry('qa'), ctx, line => lines.push(line))

    await session.stop()

    expect(lines).toEqual([])
  })

  it('start and stop are idempotent against the retained instance', async () => {
    const lines: string[] = []
    const session = createAgentRuntimeSession(entry('backend'), ctx, line => lines.push(line))

    await session.start()
    await session.start()
    await session.stop()
    await session.stop()

    // one host line, one stop line — the second start/stop are guarded no-ops.
    expect(lines).toEqual([
      'agent-runtime: + backend hosting backend@example.test (owner owner@example.test)',
      'agent-runtime: - backend stopped backend@example.test (owner owner@example.test)',
    ])
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

describe('resolveAgentRuntimeContext', () => {
  let home: string

  function entryWithHome(name: string, homeDir: string): AgentEntry {
    return { name, uid: 1000, home: homeDir, email: `${name}@example.test`, registeredAt: 0 }
  }

  function writeIdentity(homeDir: string, identity: Record<string, string>) {
    const dir = join(homeDir, '.config', 'apes')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'auth.json'), JSON.stringify(identity))
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'nest-runtime-ctx-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('reads the owner email from the agent home and resolves the bridge config', () => {
    writeIdentity(home, {
      email: 'backend@id.openape.ai',
      idp: 'https://id.openape.ai',
      owner_email: 'patrick@hofmann.eco',
    })

    const ctx = resolveAgentRuntimeContext(entryWithHome('backend', home), {
      APE_CHAT_BRIDGE_MODEL: 'claude-haiku-4-5',
    })

    expect(ctx.ownerEmail).toBe('patrick@hofmann.eco')
    expect(ctx.bridgeConfig.model).toBe('claude-haiku-4-5')
  })

  it('reads each agent identity from its own home, not the process home', () => {
    const backend = mkdtempSync(join(tmpdir(), 'nest-rt-backend-'))
    const qa = mkdtempSync(join(tmpdir(), 'nest-rt-qa-'))
    try {
      writeIdentity(backend, { email: 'b@id.test', idp: 'https://id.test', owner_email: 'owner-b@test' })
      writeIdentity(qa, { email: 'q@id.test', idp: 'https://id.test', owner_email: 'owner-q@test' })
      const env = { APE_CHAT_BRIDGE_MODEL: 'm' }

      expect(resolveAgentRuntimeContext(entryWithHome('backend', backend), env).ownerEmail).toBe('owner-b@test')
      expect(resolveAgentRuntimeContext(entryWithHome('qa', qa), env).ownerEmail).toBe('owner-q@test')
    }
    finally {
      rmSync(backend, { recursive: true, force: true })
      rmSync(qa, { recursive: true, force: true })
    }
  })

  it('throws when the agent home has no identity file', () => {
    expect(() => resolveAgentRuntimeContext(entryWithHome('ghost', home), { APE_CHAT_BRIDGE_MODEL: 'm' }))
      .toThrow(/identity not found/)
  })
})
