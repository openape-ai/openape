import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../server/database/drizzle', () => ({ useDb: () => { throw new Error('no database in this test') } }))
vi.mock('../server/utils/branch-protection', () => ({ protectionsFor: async () => [] }))

const { branchDeletionRefusal, deleteBranchRef } = await import('../server/utils/branch-delete')

const base = { defaultBranch: 'main', protectedBranches: ['release'], openPullRefs: ['refs/heads/feature/open', 'main'] }

describe('branch deletion refusal', () => {
  it('refuses the default branch, protected branches and branches of open pull requests', () => {
    expect(branchDeletionRefusal({ ...base, branch: 'main' })).toMatch(/default branch/)
    expect(branchDeletionRefusal({ ...base, branch: 'release' })).toMatch(/protected/)
    expect(branchDeletionRefusal({ ...base, branch: 'feature/open' })).toMatch(/open pull request/)
  })

  it('allows any other branch', () => {
    expect(branchDeletionRefusal({ ...base, branch: 'feature/merged' })).toBeNull()
  })
})

describe('deleteBranchRef', () => {
  let repo: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'ape-git-branch-delete-'))
    git('init', '-q', '-b', 'main', '.')
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    git('add', '.')
    git('-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-qm', 'base')
    git('branch', 'feature/done')
  })

  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  it('keeps the branch when it moved away from the expected sha', async () => {
    const sha = git('rev-parse', 'feature/done')
    await expect(deleteBranchRef(repo, 'feature/done', 'f'.repeat(40))).rejects.toThrow()
    expect(git('rev-parse', 'feature/done')).toBe(sha)
  })

  it('deletes the branch at the expected sha', async () => {
    await deleteBranchRef(repo, 'feature/done', git('rev-parse', 'feature/done'))
    expect(git('branch', '--list', 'feature/done')).toBe('')
    expect(git('branch', '--list', 'main')).toContain('main')
  })
})
