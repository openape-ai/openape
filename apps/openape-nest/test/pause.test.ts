import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Pause predicate: an agent runs no LLM turns when either the whole nest is
// paused or the agent is individually paused. The dispatch + tick guards read
// this live, so resume reverts without a respawn.

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'nest-pause-'))
  vi.stubEnv('OPENAPE_NEST_REGISTRY_PATH', join(tmp, 'agents.json'))
  vi.stubEnv('HOME', tmp)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(tmp, { recursive: true, force: true })
})

function seedAgent(name: string) {
  return import('../src/lib/registry').then(({ upsertAgent }) => {
    upsertAgent({ name, uid: 1, home: join('/tmp', name), email: `${name}@id.openape.ai`, registeredAt: 1 })
  })
}

describe('pause', () => {
  it('setAgentPaused toggles the flag + stamps pausedAt, clears it on resume', async () => {
    const { setAgentPaused, findAgent } = await import('../src/lib/registry')
    await seedAgent('zaz')

    expect(setAgentPaused('zaz', true)).toBe(true)
    expect(findAgent('zaz')?.paused).toBe(true)
    expect(findAgent('zaz')?.pausedAt).toBeTypeOf('number')

    expect(setAgentPaused('zaz', false)).toBe(true)
    expect(findAgent('zaz')?.paused).toBe(false)
  })

  it('setAgentPaused returns false for an unknown agent', async () => {
    const { setAgentPaused } = await import('../src/lib/registry')
    expect(setAgentPaused('ghost', true)).toBe(false)
  })

  it('isAgentPaused is false by default, true when the agent is paused', async () => {
    const { isAgentPaused } = await import('../src/lib/nest-state')
    const { setAgentPaused } = await import('../src/lib/registry')
    await seedAgent('zaz')

    expect(isAgentPaused('zaz')).toBe(false)
    setAgentPaused('zaz', true)
    expect(isAgentPaused('zaz')).toBe(true)
  })

  it('nest pause makes every agent paused regardless of its own flag', async () => {
    const { isAgentPaused, setNestPaused } = await import('../src/lib/nest-state')
    await seedAgent('zaz')

    expect(isAgentPaused('zaz')).toBe(false)
    setNestPaused(true)
    expect(isAgentPaused('zaz')).toBe(true)
    setNestPaused(false)
    expect(isAgentPaused('zaz')).toBe(false)
  })

  it('dispatchTurn drops the turn when paused, before any LLM work', async () => {
    const { upsertAgent, setAgentPaused } = await import('../src/lib/registry')
    const { resolveAgentRuntimeContext } = await import('../src/lib/agent-runtime-session')

    // Agent home with a minimal DDISA identity (resolveAgentRuntimeContext needs it).
    const home = join(tmp, 'zaz-home')
    mkdirSync(join(home, '.config', 'apes'), { recursive: true })
    writeFileSync(join(home, '.config', 'apes', 'auth.json'), JSON.stringify({ email: 'zaz@id.openape.ai', idp: 'https://id.openape.ai', owner_email: 'patrick@hofmann.eco' }))
    upsertAgent({ name: 'zaz', uid: 1, home, email: 'zaz@id.openape.ai', registeredAt: 1 })

    const logs: string[] = []
    // No LITELLM_API_KEY: if the guard did NOT short-circuit, the default
    // dispatch path would log the "cannot dispatch — LITELLM_API_KEY unset"
    // line instead. Asserting we get the pause line proves it returns first.
    const ctx = resolveAgentRuntimeContext({ name: 'zaz', uid: 1, home, email: 'zaz@id.openape.ai', registeredAt: 1 }, { APE_CHAT_BRIDGE_MODEL: 'm' }, l => logs.push(l))
    setAgentPaused('zaz', true)
    ctx.dispatchTurn?.({ id: 'm1', roomId: 'r1', threadId: 't1', senderEmail: 'patrick@hofmann.eco', senderAct: 'human', body: 'hi', replyTo: null, createdAt: 0, editedAt: null })

    expect(logs.some(l => l.includes('paused'))).toBe(true)
    expect(logs.some(l => l.includes('LITELLM_API_KEY'))).toBe(false)
  })
})
