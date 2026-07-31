import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createCliHarness } from '../../proof-cli/test/cli-harness'

// Black-box: spawns dist/cli.mjs as a subprocess with an isolated HOME and
// unroutable endpoints — no internals imported, no network, no real config.
const cli = createCliHarness(join(import.meta.dirname, '..'), 'dist/cli.mjs')
afterAll(() => cli.dispose())

describe('ape-tasks (black-box)', () => {
  it('--help exits 0 and lists the task commands', () => {
    const res = cli.run('--help')
    expect(res.status).toBe(0)
    for (const cmd of ['list', 'new', 'edit', 'done', 'lanes', 'whoami', 'docs']) {
      expect(res.stdout).toContain(cmd)
    }
  })

  it('docs lists topics and prints one without touching the network', () => {
    const list = cli.run('docs')
    expect(list.status).toBe(0)
    expect(list.stdout).toContain('Available topics:')
    expect(list.stdout).toContain('agent')

    const topic = cli.run('docs', 'agent')
    expect(topic.status).toBe(0)
    expect(topic.stdout.length).toBeGreaterThan(100)

    const missing = cli.run('docs', 'nosuchtopic')
    expect(missing.status).toBe(1)
    expect(missing.stdout).toContain('No such topic')
  })

  it('list without auth fails with a clear error and no stdout noise', () => {
    const res = cli.run('list', '--json')
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('Not logged in')
    expect(res.stderr).toContain('apes login')
    expect(res.stdout).toBe('')
  })

  it('login is a stub that points at the unified apes session', () => {
    const res = cli.run('login', 'someone@example.com')
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('apes login')
  })
})
