import { describe, expect, it } from 'vitest'
import { buildIssueGet, buildPrCreate, buildPrMerge, buildPrStatus, detectForge, shq } from '../src/lib/coding/forge'
import { classifyChange, decideMerge, globToRegExp, matchesAny, SECURE_DEFAULT_POLICY } from '../src/lib/coding/merge-policy'
import type { MergePolicy } from '../src/lib/coding/merge-policy'
import { buildBranchName, buildTaskPrompt, slugify } from '../src/lib/coding/issue-task'
import { BudgetExceededError, BudgetTracker } from '../src/lib/coding/budget'
import { gateMerge } from '../src/lib/coding/review-gate'

describe('forge: detect + escape', () => {
  it('detects github / azure / rejects unknown', () => {
    expect(detectForge('https://github.com/openape-ai/openape.git')).toBe('github')
    expect(detectForge('git@github.com:openape-ai/openape.git')).toBe('github')
    expect(detectForge('https://dev.azure.com/org/proj/_git/repo')).toBe('azure')
    expect(detectForge('https://org.visualstudio.com/proj/_git/repo')).toBe('azure')
    expect(() => detectForge('https://gitlab.com/x/y.git')).toThrow(/unsupported forge/)
  })

  it('shq escapes embedded single quotes safely', () => {
    expect(shq('plain')).toBe('\'plain\'')
    expect(shq('it\'s')).toBe('\'it\'\\\'\'s\'')
  })
})

describe('forge: command builders', () => {
  it('gh pr create with + without base', () => {
    expect(buildPrCreate({ forge: 'github', title: 'T', body: 'B', head: 'feat/x' }))
      .toBe('gh pr create --title \'T\' --body \'B\' --head \'feat/x\'')
    expect(buildPrCreate({ forge: 'github', title: 'T', body: 'B', head: 'feat/x', base: 'main' }))
      .toContain('--base \'main\'')
  })

  it('az pr create uses --description/--source-branch', () => {
    const cmd = buildPrCreate({ forge: 'azure', title: 'T', body: 'B', head: 'feat/x', base: 'main' })
    expect(cmd).toContain('az repos pr create')
    expect(cmd).toContain('--description \'B\'')
    expect(cmd).toContain('--source-branch \'feat/x\'')
    expect(cmd).toContain('--target-branch \'main\'')
  })

  it('gh pr merge: --auto + --squash by default', () => {
    expect(buildPrMerge({ forge: 'github', ref: 123, auto: true })).toBe('gh pr merge \'123\' --squash --auto')
    expect(buildPrMerge({ forge: 'github', ref: 'feat/x', deleteBranch: true })).toContain('--delete-branch')
  })

  it('az pr merge: auto-complete vs completed', () => {
    expect(buildPrMerge({ forge: 'azure', ref: 99, auto: true })).toContain('--auto-complete true')
    expect(buildPrMerge({ forge: 'azure', ref: 99 })).toContain('--status completed')
    expect(() => buildPrMerge({ forge: 'azure', ref: 'not-a-number' })).toThrow(/id must be a number/)
  })

  it('status + issue builders', () => {
    expect(buildPrStatus('github', 7)).toContain('gh pr view \'7\' --json')
    expect(buildPrStatus('azure', 7)).toContain('az repos pr show --id 7')
    expect(buildIssueGet('github', 7)).toContain('gh issue view 7 --json')
    expect(buildIssueGet('azure', 7)).toContain('az boards work-item show --id 7')
  })

  it('rejects injection in branch', () => {
    expect(() => buildPrCreate({ forge: 'github', title: 'T', body: 'B', head: 'x\'; rm -rf ~' })).toThrow(/branch must match/)
  })
})

describe('merge-policy', () => {
  // A repo's OWN policy (would live in its .openape/coding.json) — the
  // library ships no opinionated path lists.
  const POL: MergePolicy = {
    autoMergeEnabled: true,
    autoPaths: ['**/*.md', '.changeset/**'],
    riskPaths: ['**/auth/**', 'packages/proxy/**'],
  }

  it('globToRegExp handles ** / * / literals', () => {
    expect(globToRegExp('**/auth/**').test('packages/x/auth/login.ts')).toBe(true)
    expect(globToRegExp('**/*.md').test('docs/readme.md')).toBe(true)
    expect(globToRegExp('packages/proxy/**').test('packages/proxy/src/a.ts')).toBe(true)
    expect(globToRegExp('**/*.md').test('src/a.ts')).toBe(false)
    expect(matchesAny('a/b/auth/c.ts', POL.riskPaths)).toBe(true)
  })

  it('classifies chore / code / risk against the repo policy', () => {
    expect(classifyChange(['docs/x.md', '.changeset/y.md'], POL)).toBe('chore')
    expect(classifyChange(['packages/apes/src/lib/coding/verify.ts'], POL)).toBe('code')
    expect(classifyChange(['packages/auth/src/x.ts'], POL)).toBe('risk')
    expect(classifyChange(['docs/x.md', 'packages/auth/src/x.ts'], POL)).toBe('risk') // risk wins
    expect(classifyChange([], POL)).toBe('code') // empty = conservative
  })

  it('secure default: no policy → nothing auto-merges, human required', () => {
    // SECURE_DEFAULT_POLICY has autoMergeEnabled:false and no globs.
    expect(decideMerge(['docs/a.md'])).toMatchObject({ autoMerge: false, needsHuman: true })
    expect(decideMerge(['src/a.ts'])).toMatchObject({ autoMerge: false, needsHuman: true })
    expect(SECURE_DEFAULT_POLICY.autoMergeEnabled).toBe(false)
    expect(SECURE_DEFAULT_POLICY.riskPaths).toEqual([])
  })

  it('decideMerge maps class → gates when the repo opts in', () => {
    expect(decideMerge(['docs/a.md'], POL)).toMatchObject({ classification: 'chore', autoMerge: true, needsReview: false, needsHuman: false })
    expect(decideMerge(['src/a.ts'], POL)).toMatchObject({ classification: 'code', autoMerge: true, needsReview: true, needsHuman: false })
    expect(decideMerge(['packages/proxy/x.ts'], POL)).toMatchObject({ classification: 'risk', autoMerge: false, needsHuman: true })
  })
})

describe('issue-task', () => {
  it('slugify + branch name', () => {
    expect(slugify('Fix the Büro Login!!')).toBe('fix-the-buro-login')
    expect(buildBranchName({ number: 42, title: 'Fix login', type: 'fix' })).toBe('fix/issue-42-fix-login')
    expect(buildBranchName({ number: '#7', title: 'Add X' })).toBe('fix/issue-7-add-x')
    expect(() => buildBranchName({ number: 'abc', title: 'x' })).toThrow(/issue number required/)
  })

  it('task prompt references the issue', () => {
    const p = buildTaskPrompt({ number: 42, title: 'Fix login', body: 'It breaks' })
    expect(p).toContain('#42')
    expect(p).toContain('It breaks')
    expect(p).toContain('open a PR')
  })
})

describe('budget', () => {
  it('trips on tokens / wallclock / kill', () => {
    const b = new BudgetTracker({ maxTokens: 100, maxWallMs: 1000 }, 0)
    b.addTokens(50)
    expect(() => b.check(500)).not.toThrow()
    b.addTokens(60)
    expect(() => b.check(500)).toThrow(BudgetExceededError)
    const b2 = new BudgetTracker({ maxWallMs: 1000 }, 0)
    expect(() => b2.check(2000)).toThrow(/wall-clock/)
    const b3 = new BudgetTracker({}, 0)
    b3.kill()
    expect(() => b3.check(0)).toThrow(/kill-switch/)
  })
})

describe('review-gate', () => {
  const POL: MergePolicy = {
    autoMergeEnabled: true,
    autoPaths: ['**/*.md'],
    riskPaths: ['**/auth/**'],
  }
  const approve = async () => ({ approved: true, reason: 'lgtm' })
  const block = async () => ({ approved: false, reason: 'nope' })

  it('risk → human, no reviewer call', async () => {
    const out = await gateMerge(decideMerge(['packages/auth/x.ts'], POL), { prRef: 1, diff: '' }, approve)
    expect(out).toMatchObject({ armMerge: false, awaitingHuman: true })
  })

  it('chore → arm without reviewer', async () => {
    const out = await gateMerge(decideMerge(['a.md'], POL), { prRef: 1, diff: '' }, block)
    expect(out.armMerge).toBe(true)
  })

  it('code → reviewer gates', async () => {
    expect((await gateMerge(decideMerge(['src/a.ts'], POL), { prRef: 1, diff: 'd' }, approve)).armMerge).toBe(true)
    expect((await gateMerge(decideMerge(['src/a.ts'], POL), { prRef: 1, diff: 'd' }, block)).armMerge).toBe(false)
  })

  it('secure default (no repo policy) → human even for chore', async () => {
    const out = await gateMerge(decideMerge(['a.md']), { prRef: 1, diff: '' }, approve)
    expect(out).toMatchObject({ armMerge: false, awaitingHuman: true })
  })
})
