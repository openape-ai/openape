import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  source: new Map<string, string>(), target: new Map<string, string>(),
  states: [] as any[], attempts: [] as any[], fail: 0, calls: 0,
}))
vi.mock('../server/utils/repos', () => ({ repoDiskPath: () => '/repo' }))
vi.mock('../server/database/drizzle', async () => {
  const tables = await import('../server/database/schema')
  return { useDb: () => ({
    select: () => ({ from: (table: unknown) => ({ where: async () => table === tables.mirrors
      ? [{ id: 'mirror', repoId: 'repo', enabled: 1, url: 'https://example.test/repo', username: 'bot', token: 'secret' }]
      : [...fake.states],
    }) }),
    insert: (table: unknown) => ({ values: (row: any) => {
      if (table === tables.mirrorPushes) { fake.attempts.push(row); return Promise.resolve() }
      return { onConflictDoUpdate: async () => {
        fake.states = [...fake.states.filter(s => s.ref !== row.ref), row]
      } }
    } }),
  }) }
})
vi.mock('../server/utils/mirror', async importOriginal => ({
  ...await importOriginal<typeof import('../server/utils/mirror')>(),
  localMirrorRefs: async () => new Map(fake.source),
  remoteMirrorRefs: async () => new Map(fake.target),
  pushRefToMirror: async (_dir: string, _mirror: unknown, ref: string, _exec: unknown, expected: { sourceSha: string | null }) => {
    fake.calls++
    if (fake.fail-- > 0) return { ok: false, error: 'temporary connection failure' }
    if (expected.sourceSha) fake.target.set(ref, expected.sourceSha)
    else fake.target.delete(ref)
    return { ok: true }
  },
}))

const { reconcileMirrors } = await import('../server/utils/mirror-reconcile')
const repo = { id: 'repo', owner: 'o', name: 'r' }
const ref = 'refs/heads/main'

beforeEach(() => {
  fake.source.clear(); fake.target.clear(); fake.states = []; fake.attempts = []; fake.fail = 0; fake.calls = 0
})

describe('durable mirror reconciliation', () => {
  it('retries temporary failures and records verified source and destination SHAs', async () => {
    vi.useFakeTimers()
    try {
      fake.source.set(ref, 'a'.repeat(40)); fake.fail = 2
      const work = reconcileMirrors(repo)
      await vi.runAllTimersAsync()
      await work
      expect(fake.calls).toBe(3)
      expect(fake.attempts.map(a => a.ok)).toEqual([0, 0, 1])
      expect(fake.states[0]).toMatchObject({ sourceSha: 'a'.repeat(40), targetSha: 'a'.repeat(40), error: null })
    }
    finally { vi.useRealTimers() }
  })

  it('stops after three failures and recovers on a later scan', async () => {
    vi.useFakeTimers()
    try {
      fake.source.set(ref, 'b'.repeat(40)); fake.fail = 10
      const work = reconcileMirrors(repo)
      await vi.runAllTimersAsync(); await work
      expect(fake.calls).toBe(3)
      expect(fake.states[0].error).toContain('connection')
      fake.fail = 0
      await reconcileMirrors(repo)
      expect(fake.states[0].error).toBeNull()
      expect(fake.target.get(ref)).toBe('b'.repeat(40))
    }
    finally { vi.useRealTimers() }
  })

  it('uses current refs, preserves unrelated remote refs and reconciles missed deletions', async () => {
    fake.source.set(ref, 'c'.repeat(40)); fake.target.set('refs/heads/foreign', 'f'.repeat(40))
    await Promise.all([reconcileMirrors(repo), reconcileMirrors(repo)])
    expect(fake.calls).toBe(1)
    fake.source.delete(ref)
    await reconcileMirrors(repo)
    expect(fake.target.has(ref)).toBe(false)
    expect(fake.target.has('refs/heads/foreign')).toBe(true)
  })

  it('refuses deletion after the destination was changed independently', async () => {
    fake.source.set(ref, 'a'.repeat(40)); await reconcileMirrors(repo)
    fake.source.delete(ref); fake.target.set(ref, 'd'.repeat(40))
    await reconcileMirrors(repo)
    expect(fake.calls).toBe(1)
    expect(fake.target.get(ref)).toBe('d'.repeat(40))
    expect(fake.states[0].error).toContain('Deletion refused')
  })
})
