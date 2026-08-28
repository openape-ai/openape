import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMergeCommit, diffPatch, mergeBase, mergeMessage, mergePreview, parseConflicts } from '../server/utils/git-merge'
import { parsePatch } from '../server/utils/git-parse'

// The PR endpoints store nothing but the ref pair, so the interesting part is
// what git answers: the three-dot diff, whether the merge is clean, and the
// merge commit itself. This exercises all three against a real repository.

let repo: string

function git(args: string[], env: Record<string, string> = {}) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } })
}

function commit(file: string, content: string, message: string) {
  writeFileSync(join(repo, file), content)
  git(['add', '.'])
  git(['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', message], {
    GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
  })
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'ape-git-pull-'))
  git(['init', '-q', '-b', 'main', '.'])
  commit('app.txt', 'one\n', 'base')

  git(['checkout', '-q', '-b', 'feature'])
  commit('app.txt', 'one\ntwo\n', 'feature work')
  commit('added.txt', 'new file\n', 'add a file')

  git(['checkout', '-q', 'main'])
  commit('unrelated.txt', 'main moved on\n', 'main work')

  git(['checkout', '-q', '-b', 'conflicting', 'main'])
  commit('app.txt', 'one\nCONFLICT\n', 'touch the same line')
  git(['checkout', '-q', 'main'])
})

afterAll(() => rmSync(repo, { recursive: true, force: true }))

describe('pull request diff', () => {
  it('is what `git diff target...source` prints', async () => {
    const { patch, truncated } = await diffPatch(repo, 'main', 'feature', 1_000_000)
    expect(truncated).toBe(false)
    expect(patch).toBe(git(['diff', '--no-color', '--find-renames', 'main...feature']))
  })

  it('leaves out what only the target changed', async () => {
    const { patch } = await diffPatch(repo, 'main', 'feature', 1_000_000)
    // unrelated.txt is main's own commit — a two-dot diff would show it deleted.
    expect(patch).not.toContain('unrelated.txt')
    expect(patch).toContain('added.txt')
  })

  it('reports truncation instead of returning a partial patch silently', async () => {
    const { patch, truncated } = await diffPatch(repo, 'main', 'feature', 20)
    expect(truncated).toBe(true)
    expect(patch).toHaveLength(20)
  })
})

describe('parsePatch', () => {
  it('numbers added lines on the new side', async () => {
    const { patch } = await diffPatch(repo, 'main', 'feature', 1_000_000)
    const app = parsePatch(patch).find(f => f.path === 'app.txt')!
    expect(app.additions).toBe(1)
    expect(app.deletions).toBe(0)
    const added = app.lines.find(l => l.type === 'add')!
    expect(added).toMatchObject({ text: 'two', newLine: 2, oldLine: null })
  })

  it('keeps both sides in step across a modified hunk', () => {
    const files = parsePatch([
      'diff --git a/f.txt b/f.txt',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -10,3 +10,3 @@',
      ' keep',
      '-old',
      '+new',
      ' tail',
      '',
    ].join('\n'))
    expect(files[0]!.lines.map(l => [l.type, l.oldLine, l.newLine])).toEqual([
      ['hunk', null, null],
      ['ctx', 10, 10],
      ['del', 11, null],
      ['add', null, 11],
      ['ctx', 12, 12],
    ])
  })

  it('marks a rename and a binary file without inventing lines', () => {
    const files = parsePatch([
      'diff --git a/old.txt b/new.txt',
      'similarity index 100%',
      'rename from old.txt',
      'rename to new.txt',
      'diff --git a/logo.png b/logo.png',
      'Binary files a/logo.png and b/logo.png differ',
      '',
    ].join('\n'))
    expect(files[0]).toMatchObject({ path: 'new.txt', oldPath: 'old.txt', lines: [] })
    expect(files[1]).toMatchObject({ path: 'logo.png', binary: true })
  })
})

describe('mergeability', () => {
  it('sees a clean merge and writes its tree', async () => {
    const preview = await mergePreview(repo, 'main', 'feature')
    expect(preview.mergeable).toBe(true)
    expect(preview.tree).toMatch(/^[0-9a-f]{40}$/)
  })

  it('names the conflicting files instead of just failing', async () => {
    const preview = await mergePreview(repo, 'conflicting', 'feature')
    expect(preview.mergeable).toBe(false)
    expect(preview.conflicts).toEqual(['app.txt'])
  })

  it('parses conflict paths out of merge-tree output', () => {
    const out = [
      'd44a9430a9bdf9e98f397d9ec6f11d3ce5006f7e',
      `100644 ${'1'.repeat(40)} 1\tsrc/a.ts`,
      `100644 ${'2'.repeat(40)} 2\tsrc/a.ts`,
      `100644 ${'3'.repeat(40)} 3\tsrc/a.ts`,
      '',
      'CONFLICT (content): Merge conflict in src/a.ts',
    ].join('\n')
    expect(parseConflicts(out)).toEqual(['src/a.ts'])
  })
})

describe('merge commit', () => {
  it('carries the merging identity and both parents, and moves the branch', async () => {
    const target = git(['rev-parse', 'main']).trim()
    const source = git(['rev-parse', 'feature']).trim()
    const preview = await mergePreview(repo, target, source)

    const sha = await createMergeCommit(repo, {
      tree: preview.tree!,
      target,
      source,
      targetRef: 'refs/heads/main',
      expectedTarget: target,
      message: mergeMessage(7, 'Add two', 'feature', 'main'),
      identity: { name: 'patrick', email: 'patrick@hofmann.eco' },
    })

    expect(git(['rev-parse', 'main']).trim()).toBe(sha)
    expect(git(['rev-list', '--parents', '-n', '1', sha]).trim().split(' ').slice(1)).toEqual([target, source])
    expect(git(['show', '-s', '--format=%ce %s', sha]).trim())
      .toBe('patrick@hofmann.eco Merge pull request #7 from feature into main')
    // The merge actually brought the change in, it isn't just a commit.
    expect(git(['show', 'main:app.txt'])).toBe('one\ntwo\n')
  })

  it('refuses to move a branch that changed since the preview', async () => {
    const stale = git(['rev-parse', 'main~1']).trim()
    const preview = await mergePreview(repo, 'main', 'conflicting')
    await expect(createMergeCommit(repo, {
      tree: preview.tree!,
      target: git(['rev-parse', 'main']).trim(),
      source: git(['rev-parse', 'conflicting']).trim(),
      targetRef: 'refs/heads/main',
      expectedTarget: stale,
      message: 'nope',
      identity: { name: 'patrick', email: 'patrick@hofmann.eco' },
    })).rejects.toThrow()
  })
})

describe('mergeBase', () => {
  it('reports the source tip when the target already contains it', async () => {
    // main now contains feature — that is how the merge endpoint detects
    // "nothing to merge" instead of writing an empty merge commit.
    const source = git(['rev-parse', 'feature']).trim()
    expect(await mergeBase(repo, 'main', 'feature')).toBe(source)
  })
})
