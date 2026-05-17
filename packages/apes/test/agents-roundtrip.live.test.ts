import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'

// LIVE-gated end-to-end roundtrip. Hits whatever IdP the local `apes login`
// session points at, plus (for spawn/destroy) a working `escapes` install
// and an approver willing to OK the as=root grant.
//
// Run with: LIVE=1 pnpm vitest run agents-roundtrip.live
//
// Two paths exercised:
// 1. register → list → destroy --keep-os-user --force (no escapes needed)
// 2. spawn → list (asserts OS user present) → destroy --force
const SHOULD_RUN = process.env.LIVE === '1' || process.env.OPENAPE_LIVE_TEST === '1'

const APES_BIN = process.env.APES_BIN || 'apes'

function apes(...argv: string[]): string {
  return execFileSync(APES_BIN, argv, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'] })
}

function genName(prefix: string): string {
  return `${prefix}-${randomBytes(3).toString('hex')}`
}

interface ListEntry {
  email: string
  name: string
  isActive: boolean
  osUser: boolean
  home: string | null
}

function listAgentsJson(): ListEntry[] {
  return JSON.parse(apes('agents', 'list', '--json'))
}

describe.skipIf(!SHOULD_RUN)('apes agents — LIVE roundtrip', () => {
  const cleanupNames: string[] = []

  afterAll(() => {
    // Best-effort cleanup so failed mid-test runs don't leak agents.
    for (const name of cleanupNames) {
      try { apes('agents', 'destroy', name, '--keep-os-user', '--force') }
      catch {}
    }
  })

  it('register → list → destroy --keep-os-user --force', () => {
    const name = genName('it-reg')
    cleanupNames.push(name)

    const tmp = mkdtempSync(join(tmpdir(), 'apes-it-'))
    const keyPath = join(tmp, 'id_ed25519')
    try {
      execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', keyPath, '-N', '', '-q', '-C', name], { stdio: 'ignore' })
      const pub = readFileSync(`${keyPath}.pub`, 'utf-8').trim()

      const out = apes('agents', 'register', '--name', name, '--public-key', pub, '--json').trim()
      const reg = JSON.parse(out)
      expect(reg.name).toBe(name)
      expect(reg.email).toContain(`${name}+`)

      const before = listAgentsJson()
      expect(before.find(a => a.name === name)).toBeDefined()

      apes('agents', 'destroy', name, '--keep-os-user', '--force')

      const after = listAgentsJson()
      expect(after.find(a => a.name === name)).toBeUndefined()
    }
    finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it.skipIf(!process.env.OPENAPE_LIVE_SPAWN)('spawn → list → destroy --force (requires OPENAPE_LIVE_SPAWN=1 and approver)', () => {
    const name = genName('it-spw')
    cleanupNames.push(name)

    apes('agents', 'spawn', name, '--no-claude-hook')

    const list = listAgentsJson()
    const entry = list.find(a => a.name === name)
    expect(entry).toBeDefined()
    expect(entry!.osUser).toBe(true)
    expect(entry!.home).toBe(`/Users/${name}`)

    apes('agents', 'destroy', name, '--force')

    const after = listAgentsJson()
    expect(after.find(a => a.name === name)).toBeUndefined()

    // Idempotency: a second destroy on a now-clean name is a no-op (exit 0).
    apes('agents', 'destroy', name, '--force')
  })

  it('idempotent destroy on a name that never existed', () => {
    const name = genName('it-noop')
    apes('agents', 'destroy', name, '--keep-os-user', '--force')
  })
})

// Stub spec ensures the file is picked up by the test runner even when
// SHOULD_RUN is false; without it, `describe.skipIf(true)` produces "no tests
// found" and the CLI exits non-zero.
describe('apes agents — LIVE roundtrip (placeholder)', () => {
  it('skipped unless LIVE=1', () => {
    if (!SHOULD_RUN) {
      console.log('agents-roundtrip.live: skipped (set LIVE=1 to run)')
    }
    expect(true).toBe(true)
  })
})

// Silence unused-import warnings when SHOULD_RUN=false.
void writeFileSync
