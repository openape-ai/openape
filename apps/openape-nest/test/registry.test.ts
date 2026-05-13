import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'nest-registry-'))
  // OPENAPE_NEST_REGISTRY_PATH override is mandatory — without it
  // resolveRegistryPath() falls back to checking `/var/openape/nest/`,
  // which on a dev box hosting a real nest install means every
  // write in this test (including the deliberately-corrupt
  // "{not json" case) clobbers the production registry. We lived
  // through that exact outage once — see #408 follow-up.
  vi.stubEnv('OPENAPE_NEST_REGISTRY_PATH', join(tmp, 'agents.json'))
  vi.stubEnv('HOME', tmp)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(tmp, { recursive: true, force: true })
})

describe('nest registry', () => {
  it('readRegistry returns an empty stub when the file is missing', async () => {
    const { readRegistry } = await import('../src/lib/registry')
    expect(readRegistry()).toEqual({ version: 1, agents: [] })
  })

  it('upsert + list + find + remove round-trips through the JSON file', async () => {
    const { upsertAgent, listAgents, findAgent, removeAgent, _internal } = await import('../src/lib/registry')

    upsertAgent({
      name: 'igor7',
      uid: 449,
      home: '/Users/igor7',
      email: 'igor7-cb6bf26a+x+y@id.openape.ai',
      registeredAt: 1,
    })
    expect(listAgents()).toHaveLength(1)
    expect(findAgent('igor7')?.uid).toBe(449)

    // upsert overwrites the same name
    upsertAgent({
      name: 'igor7',
      uid: 449,
      home: '/Users/igor7',
      email: 'igor7-cb6bf26a+x+y@id.openape.ai',
      registeredAt: 1,
      bridge: { model: 'gpt-5.4' },
    })
    expect(findAgent('igor7')?.bridge?.model).toBe('gpt-5.4')

    // file is on disk where we expect it (so `apes nest install` can
    // pre-seed it during a migration step later)
    expect(readFileSync(_internal.REGISTRY_PATH, 'utf8')).toContain('igor7')

    expect(removeAgent('igor7')).toBe(true)
    expect(removeAgent('igor7')).toBe(false)
    expect(listAgents()).toHaveLength(0)
  })

  it('readRegistry shrugs off corrupt JSON', async () => {
    const { _internal, readRegistry } = await import('../src/lib/registry')
    // Write a half-broken file; reader must not throw.
    const dir = join(tmp, '.openape', 'nest')
    mkdirSync(dir, { recursive: true })
    writeFileSync(_internal.REGISTRY_PATH, '{not json', 'utf8')
    expect(readRegistry()).toEqual({ version: 1, agents: [] })
  })
})
