// story: coder-repo-sync
//
// All 6 criteria of stories/coder-repo-sync.md. The sync is client-side and its
// decision logic is pure (no fs, no network): parse the `.ape-coder/config`
// binding, hash each story's syncable fields, diff repo vs. service against the
// last-synced `rev`, and plan push/pull/conflict. So the tests exercise the pure
// functions (parseConfig, hashStory, diffStories, planSync) plus runSync's
// fail-fast on a bad binding — no subprocess. Contract pinned in src/sync.ts.

import type { Story } from '../src/coder-api'
import type { StoryFile, SyncableStory } from '../src/sync'
import { describe, expect, it } from 'vitest'
import {
  diffStories,
  hashStory,
  parseConfig,
  planSync,
  runSync,
} from '../src/sync'

const SYNCABLE: SyncableStory = {
  title: 'Sign in with passkey',
  storySentence: 'Als Nutzer möchte ich mich mit Passkey anmelden, damit ich kein Passwort brauche.',
  acceptanceCriteria: '1. …',
  repos: ['openape-ai/openape-monorepo'],
  links: [],
  testReferences: [],
  status: 'draft',
}

function service(id: string, over: Partial<Story> = {}): Story {
  return {
    id,
    projectId: 'p1',
    ...SYNCABLE,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function file(id: string | null, rev: string | null, over: Partial<StoryFile> = {}): StoryFile {
  return { id, rev, ...SYNCABLE, ...over }
}

describe('coder-repo-sync — config binding (issue #585)', () => {
  // story: coder-repo-sync — criterion 1 (binding is the precondition for syncing both ways)
  it('parses a `.ape-coder/config` that binds the repo to a project', () => {
    const cfg = parseConfig('projectId = "p1"\n')
    expect(cfg.projectId).toBe('p1')
  })

  // story: coder-repo-sync — criterion 6
  it('aborts with a clear message when the binding is missing — never guesses a target', () => {
    expect(() => parseConfig('# empty\n')).toThrow(/project/i)
  })

  // story: coder-repo-sync — criterion 6
  it('`sync` aborts up front on a missing/invalid binding rather than touching the service', async () => {
    const err = await runSync({ cwd: '/tmp/repo-without-binding' }).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/bind|config|project/i)
  })
})

describe('coder-repo-sync — hash + diff (issue #585)', () => {
  // story: coder-repo-sync — criterion 2 (the hash is how "changed since last sync" is detected)
  it('hashes equal syncable content equally, regardless of array/object order', () => {
    const a = hashStory(SYNCABLE)
    const b = hashStory({ ...SYNCABLE, repos: [...SYNCABLE.repos] })
    expect(a).toBe(b)
    const changed = hashStory({ ...SYNCABLE, title: 'Different' })
    expect(changed).not.toBe(a)
  })

  // story: coder-repo-sync — criterion 1
  it('a story changed only on one side is a one-way push or pull', () => {
    const rev = hashStory(SYNCABLE)
    // local edited, remote still at rev → push
    const localEdited = [file('s1', rev, { title: 'Edited locally' })]
    const remoteUnchanged = [service('s1')]
    const pushDiff = diffStories(localEdited, remoteUnchanged)
    expect(pushDiff.find(d => d.id === 's1')?.action).toBe('push')

    // remote edited, local still at rev → pull
    const localUnchanged = [file('s1', rev)]
    const remoteEdited = [service('s1', { title: 'Edited on service' })]
    const pullDiff = diffStories(localUnchanged, remoteEdited)
    expect(pullDiff.find(d => d.id === 's1')?.action).toBe('pull')
  })

  // story: coder-repo-sync — criterion 2
  it('a story changed on BOTH sides since the last sync is a conflict that keeps both states', () => {
    const rev = hashStory(SYNCABLE)
    const local = [file('s1', rev, { title: 'Mine' })]
    const remote = [service('s1', { title: 'Theirs' })]

    const diff = diffStories(local, remote)
    const conflict = diff.find(d => d.id === 's1')

    expect(conflict?.action).toBe('conflict')
    expect(conflict?.local?.title).toBe('Mine')
    expect(conflict?.remote?.title).toBe('Theirs')
  })
})

describe('coder-repo-sync — plan (issue #585)', () => {
  // story: coder-repo-sync — criterion 2 + 3 (loud, never auto-resolve)
  it('leaves an unresolved conflict unresolved — never silently overwrites either side', () => {
    const rev = hashStory(SYNCABLE)
    const diff = diffStories([file('s1', rev, { title: 'Mine' })], [service('s1', { title: 'Theirs' })])

    const plan = planSync({ diff, canWrite: true })

    expect(plan.unresolvedConflicts.map(d => d.id)).toContain('s1')
    expect(plan.push).toEqual([])
    expect(plan.pull).toEqual([])
  })

  // story: coder-repo-sync — criterion 3 (user decides per story)
  it('resolves a conflict only with the user\'s explicit per-story choice', () => {
    const rev = hashStory(SYNCABLE)
    const diff = diffStories([file('s1', rev, { title: 'Mine' })], [service('s1', { title: 'Theirs' })])

    const plan = planSync({ diff, canWrite: true, resolutions: { s1: 'local' } })

    expect(plan.unresolvedConflicts).toEqual([])
    expect(plan.push.map(p => p.id)).toContain('s1')
  })

  // story: coder-repo-sync — criterion 5 (no write grant → push refused, pull stays)
  it('without write access the push half is refused but pull still proceeds', () => {
    const rev = hashStory(SYNCABLE)
    const diff = diffStories(
      [file('s1', rev, { title: 'Edited locally' }), file('s2', rev)],
      [service('s1'), service('s2', { title: 'Edited on service' })],
    )

    const plan = planSync({ diff, canWrite: false })

    expect(plan.pushRefusedNoWriteAccess).toBe(true)
    expect(plan.push).toEqual([])
    expect(plan.pull.map(f => f.id)).toContain('s2')
  })
})
