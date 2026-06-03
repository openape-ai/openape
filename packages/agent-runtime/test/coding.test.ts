import { describe, expect, it } from 'vitest'
import { buildIssueGet, buildPrCreate, buildPrMerge, buildPrStatus, detectForge, listForges, registerForge, shq } from '../src/coding/forge'
import type { ForgeAdapter } from '../src/coding/forge'
import { classifyChange, decideMerge, globToRegExp, matchesAny, SECURE_DEFAULT_POLICY } from '../src/coding/merge-policy'
import type { MergePolicy } from '../src/coding/merge-policy'
import { buildBranchName, buildTaskPrompt, slugify } from '../src/coding/issue-task'
import { BudgetExceededError, BudgetTracker } from '../src/coding/budget'
import { gateMerge } from '../src/coding/review-gate'
import { extractWorkflowPaths, parseCodeowners } from '../src/coding/derive-policy'

describe('forge: detect + escape', () => {
  it('detects built-in github / azure', () => {
    expect(detectForge('https://github.com/openape-ai/openape.git')).toBe('github')
    expect(detectForge('git@github.com:openape-ai/openape.git')).toBe('github')
    expect(detectForge('https://dev.azure.com/org/proj/_git/repo')).toBe('azure')
    expect(detectForge('https://org.visualstudio.com/proj/_git/repo')).toBe('azure')
  })

  it('unknown remote → helpful error listing registered forges (not a hard 2-provider lock)', () => {
    expect(() => detectForge('https://example.org/x/y.git')).toThrow(/no forge adapter matches/)
    expect(() => detectForge('https://example.org/x/y.git')).toThrow(/registerForge/)
  })

  it('shq escapes embedded single quotes safely', () => {
    expect(shq('plain')).toBe('\'plain\'')
    expect(shq('it\'s')).toBe('\'it\'\\\'\'s\'')
  })
})

describe('forge: extensibility (Bitbucket/GitLab/Gitea not locked out)', () => {
  it('registerForge adds a custom forge — detect + build work', () => {
    const bitbucket: ForgeAdapter = {
      id: 'bitbucket',
      matchesRemote: url => /bitbucket\.org/i.test(url),
      prCreate: i => `bb pr create --title ${shq(i.title)} --source ${shq(i.head)}`,
      prMerge: i => `bb pr merge ${String(i.ref)}`,
      prStatus: ref => `bb pr show ${String(ref)}`,
      issueGet: ref => `bb issue show ${String(ref)}`,
    }
    registerForge(bitbucket)
    expect(listForges()).toContain('bitbucket')
    expect(detectForge('https://bitbucket.org/team/repo.git')).toBe('bitbucket')
    expect(buildPrCreate({ forge: 'bitbucket', title: 'T', body: 'B', head: 'feat/x' }))
      .toBe('bb pr create --title \'T\' --source \'feat/x\'')
  })

  it('unknown forge id → error names how to add one', () => {
    expect(() => buildPrStatus('gitea', 1)).toThrow(/unknown forge 'gitea'/)
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

  it('gh pr merge: no strategy flag unless squash:true (merge strategy is repo policy)', () => {
    // Default: no --squash — the repo's own default merge strategy applies.
    expect(buildPrMerge({ forge: 'github', ref: 123, auto: true })).toBe('gh pr merge \'123\' --auto')
    // Opt in explicitly.
    expect(buildPrMerge({ forge: 'github', ref: 123, auto: true, squash: true })).toBe('gh pr merge \'123\' --squash --auto')
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
    // With a repo (issue lookup before clone): --repo must be present so
    // `gh` doesn't depend on the CWD being the target repo.
    expect(buildIssueGet('github', 7, 'https://github.com/o/n.git'))
      .toContain('gh issue view 7 --repo \'https://github.com/o/n.git\' --json')
  })

  it('rejects injection in branch', () => {
    expect(() => buildPrCreate({ forge: 'github', title: 'T', body: 'B', head: 'x\'; rm -rf ~' })).toThrow(/branch must match/)
  })
})

describe('merge-policy', () => {
  // A repo's OWN policy (would live in its .openape/coding.json) — the
  // library ships no path opinions; these globs are repo-chosen, neutral.
  const POL: MergePolicy = {
    autoMergeEnabled: true,
    autoPaths: ['**/*.md', '.changeset/**'],
    riskPaths: ['infra/**', 'config/prod/**'],
  }

  it('globToRegExp handles ** / * / literals', () => {
    expect(globToRegExp('infra/**').test('infra/terraform/main.tf')).toBe(true)
    expect(globToRegExp('**/*.md').test('docs/readme.md')).toBe(true)
    expect(globToRegExp('config/prod/**').test('config/prod/db.json')).toBe(true)
    expect(globToRegExp('**/*.md').test('src/a.ts')).toBe(false)
    expect(matchesAny('infra/x.tf', POL.riskPaths)).toBe(true)
  })

  it('classifies chore / code / risk against the repo policy', () => {
    expect(classifyChange(['docs/x.md', '.changeset/y.md'], POL)).toBe('chore')
    expect(classifyChange(['packages/apes/src/lib/coding/verify.ts'], POL)).toBe('code')
    expect(classifyChange(['infra/prod.tf'], POL)).toBe('risk')
    expect(classifyChange(['docs/x.md', 'infra/prod.tf'], POL)).toBe('risk') // risk wins
    expect(classifyChange([], POL)).toBe('code') // empty = conservative
  })

  it('library ships zero risk knowledge: nothing is risk without config/agent', () => {
    const open: MergePolicy = { autoMergeEnabled: true, autoPaths: [], riskPaths: [] }
    // Paths that a hardcoded list might have flagged are NOT risk here.
    expect(classifyChange(['packages/auth/src/x.ts'], open)).toBe('code')
    expect(classifyChange(['packages/proxy/src/x.ts'], open)).toBe('code')
  })

  it('agent judgment escalates to risk even when no glob matches', () => {
    const open: MergePolicy = { autoMergeEnabled: true, autoPaths: [], riskPaths: [] }
    const d = decideMerge(['src/login.ts'], open, { risky: true, reason: 'touches authentication logic' })
    expect(d).toMatchObject({ classification: 'risk', autoMerge: false, needsHuman: true })
    expect(d.reason).toContain('agent judged')
    // Without the agent flag the same change is plain code.
    expect(decideMerge(['src/login.ts'], open)).toMatchObject({ classification: 'code', needsReview: true })
  })

  it('secure default: no policy → nothing auto-merges, human required', () => {
    expect(decideMerge(['docs/a.md'])).toMatchObject({ autoMerge: false, needsHuman: true })
    expect(decideMerge(['src/a.ts'])).toMatchObject({ autoMerge: false, needsHuman: true })
    expect(SECURE_DEFAULT_POLICY.autoMergeEnabled).toBe(false)
    expect(SECURE_DEFAULT_POLICY.riskPaths).toEqual([])
  })

  it('decideMerge maps class → gates when the repo opts in', () => {
    expect(decideMerge(['docs/a.md'], POL)).toMatchObject({ classification: 'chore', autoMerge: true, needsReview: false, needsHuman: false })
    expect(decideMerge(['src/a.ts'], POL)).toMatchObject({ classification: 'code', autoMerge: true, needsReview: true, needsHuman: false })
    expect(decideMerge(['infra/prod.tf'], POL)).toMatchObject({ classification: 'risk', autoMerge: false, needsHuman: true })
  })
})

describe('derive-policy: signals over hand-maintained lists', () => {
  it('extracts deploy-workflow paths (block form), ignores paths-ignore', () => {
    const wf = [
      'name: Deploy',
      'on:',
      '  push:',
      '    branches: [main]',
      '    paths:',
      '      - \'apps/openape-free-idp/**\'',
      '      - packages/auth/**',
      '    paths-ignore:',
      '      - \'**/*.md\'',
      'jobs:',
      '  deploy:',
      '    runs-on: ubuntu',
    ].join('\n')
    const paths = extractWorkflowPaths(wf)
    expect(paths).toContain('apps/openape-free-idp/**')
    expect(paths).toContain('packages/auth/**')
    expect(paths).not.toContain('**/*.md') // paths-ignore is not a risk filter
  })

  it('extracts inline-array paths', () => {
    expect(extractWorkflowPaths('    paths: [\'apps/x/**\', "packages/y/**"]'))
      .toEqual(['apps/x/**', 'packages/y/**'])
  })

  it('parses CODEOWNERS patterns (dir → **, root-anchor stripped, comments/owners skipped)', () => {
    const co = [
      '# owners',
      '/packages/auth/ @team-sec',
      'apps/proxy/** @ops',
      '*.tf @infra',
      '@just-an-owner-line',
      '',
    ].join('\n')
    const paths = parseCodeowners(co)
    expect(paths).toContain('packages/auth/**')
    expect(paths).toContain('apps/proxy/**')
    expect(paths).toContain('*.tf')
    expect(paths).not.toContain('@just-an-owner-line')
  })

  it('derived globs feed straight into classifyChange as risk', () => {
    const derived = extractWorkflowPaths('    paths:\n      - \'apps/free-idp/**\'')
    expect(classifyChange(['apps/free-idp/server/x.ts'], { autoMergeEnabled: true, autoPaths: [], riskPaths: derived })).toBe('risk')
  })
})

describe('issue-task', () => {
  it('slugify + branch name', () => {
    expect(slugify('Fix the Büro Login!!')).toBe('fix-the-buro-login')
    expect(buildBranchName({ number: 42, title: 'Fix login', type: 'fix' })).toBe('fix/issue-42-fix-login')
    expect(buildBranchName({ number: '#7', title: 'Add X' })).toBe('fix/issue-7-add-x')
    expect(() => buildBranchName({ number: 'abc', title: 'x' })).toThrow(/issue number required/)
  })

  it('branch name follows a configurable template (not a baked convention)', () => {
    expect(buildBranchName({ number: 42, title: 'Fix login' }, { template: '{type}-{number}', defaultType: 'bugfix' }))
      .toBe('bugfix-42')
    expect(buildBranchName({ number: 'AB#9', title: 'X' }, { template: 'feature/{number}-{slug}', defaultType: 'feature' }))
      .toBe('feature/9-x')
  })

  it('task prompt references the issue', () => {
    const p = buildTaskPrompt({ number: 42, title: 'Fix login', body: 'It breaks' })
    expect(p).toContain('#42')
    expect(p).toContain('It breaks')
    expect(p).toContain('open a PR')
  })

  it('task prompt is composed from the recipe persona, not a baked script', () => {
    const p = buildTaskPrompt(
      { number: 7, title: 'Add X' },
      { persona: 'You are Linda, the IURIO release bot.', instructions: 'Custom: do the thing.' },
    )
    expect(p.startsWith('You are Linda, the IURIO release bot.')).toBe(true)
    expect(p).toContain('Issue #7: Add X')
    expect(p).toContain('Custom: do the thing.')
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
    riskPaths: ['infra/**'],
  }
  const approve = async () => ({ approved: true, reason: 'lgtm' })
  const block = async () => ({ approved: false, reason: 'nope' })

  it('risk → human, no reviewer call', async () => {
    const out = await gateMerge(decideMerge(['infra/prod.tf'], POL), { prRef: 1, diff: '' }, approve)
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
