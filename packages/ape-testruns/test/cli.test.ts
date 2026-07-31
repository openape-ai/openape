import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createCliHarness } from '../../proof-cli/test/cli-harness'

// Black-box: spawns dist/cli.mjs as a subprocess with an isolated HOME and
// unroutable endpoints — no internals imported, no network, no real config.
const cli = createCliHarness(join(import.meta.dirname, '..'), 'dist/cli.mjs')
afterAll(() => cli.dispose())

describe('ape-testruns (black-box)', () => {
  it('--help exits 0 and lists the test-run commands', () => {
    const res = cli.run('--help')
    expect(res.status).toBe(0)
    for (const cmd of ['upload', 'list', 'show', 'rm', 'whoami', 'docs']) {
      expect(res.stdout).toContain(cmd)
    }
  })

  it('docs lists topics and prints one without touching the network', () => {
    const list = cli.run('docs')
    expect(list.status).toBe(0)
    expect(list.stdout).toContain('Available topics:')
    expect(list.stdout).toContain('manifest')

    const topic = cli.run('docs', 'cli')
    expect(topic.status).toBe(0)
    expect(topic.stdout.length).toBeGreaterThan(100)
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
