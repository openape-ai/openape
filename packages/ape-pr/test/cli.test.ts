import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createCliHarness } from '../../proof-cli/test/cli-harness'

// Black-box: spawns dist/cli.mjs as a subprocess with an isolated HOME and
// unroutable endpoints — no internals imported, no network, no real config.
const cli = createCliHarness(join(import.meta.dirname, '..'), 'dist/cli.mjs')
afterAll(() => cli.dispose())

describe('ape-pr (black-box)', () => {
  it('--help exits 0 and lists the PR commands', () => {
    const res = cli.run('--help')
    expect(res.status).toBe(0)
    for (const cmd of ['upload', 'status', 'list', 'rm', 'whoami', 'docs']) {
      expect(res.stdout).toContain(cmd)
    }
  })

  it('docs lists topics without touching the network', () => {
    const res = cli.run('docs')
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('Available topics:')
    expect(res.stdout).toContain('manifest')
  })

  it('list without auth fails with a clear error and no stdout noise', () => {
    const res = cli.run('list')
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('Not logged in')
    expect(res.stderr).toContain('apes login')
    expect(res.stdout).toBe('')
  })

  it('whoami without auth fails with a clear error', () => {
    const res = cli.run('whoami')
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('Not logged in')
  })
})
