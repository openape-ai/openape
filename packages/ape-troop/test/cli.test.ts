import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createCliHarness } from '../../proof-cli/test/cli-harness'

// Black-box: spawns dist/cli.js as a subprocess with an isolated HOME and
// unroutable endpoints — no internals imported, no network, no real config.
const cli = createCliHarness(join(import.meta.dirname, '..'), 'dist/cli.js')
afterAll(() => cli.dispose())

describe('ape-troop (black-box)', () => {
  it('--help exits 0 and lists the troop commands', () => {
    const res = cli.run('--help')
    expect(res.status).toBe(0)
    for (const cmd of ['nests', 'agents', 'whoami', 'login', 'logout']) {
      expect(res.stdout).toContain(cmd)
    }
  })

  it('whoami without auth fails with a clear error', () => {
    const res = cli.run('whoami')
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('Not logged in')
    expect(res.stderr).toContain('apes login')
  })

  it('login is a stub that points at the unified apes session', () => {
    const res = cli.run('login')
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('apes login')
  })

  it('nests list without auth fails with a clear error and no stdout noise', () => {
    const res = cli.run('nests', 'list')
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('Not authenticated')
    expect(res.stderr).toContain('apes login')
    expect(res.stdout).toBe('')
  })
})
