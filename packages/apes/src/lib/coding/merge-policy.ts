// Merge policy (M5): classify a PR's changed files and decide how it
// may be merged, per the B+C-Overlay policy:
//   - chore (docs/changeset/etc.) → auto-merge on green CI
//   - code                        → auto-merge after reviewer-agent approval
//   - risk (auth/migrations/...)  → human approval required, never auto
//
// Pure + unit-tested. The actual CI-green check is enforced server-side
// by branch protection; this layer only governs whether the agent may
// ARM the merge and whether a reviewer/human gate applies.

export type ChangeClass = 'chore' | 'code' | 'risk'

export interface MergePolicy {
  // Globs that mark a path as low-risk chore (auto-merge candidate).
  autoPaths: string[]
  // Globs that mark a path as risky (force human review). Highest precedence.
  riskPaths: string[]
}

export const DEFAULT_MERGE_POLICY: MergePolicy = {
  autoPaths: ['**/*.md', '.changeset/**', '**/*.txt', '**/LICENSE'],
  riskPaths: [
    '**/auth/**',
    '**/*migrat*',
    '.github/workflows/deploy-*',
    'packages/proxy/**',
    '**/*secret*',
    '**/escapes/**',
    '**/grants/**',
  ],
}

// Minimal glob → RegExp. Supports `**` (any chars incl. `/`), `*` (any
// chars except `/`), and `?` (single non-`/`). Everything else literal.
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        // consume an immediately following slash so `**/x` also matches `x`
        if (glob[i + 1] === '/') i++
      }
      else {
        re += '[^/]*'
      }
    }
    else if (c === '?') {
      re += '[^/]'
    }
    else if ('.+^${}()|[]\\'.includes(c)) {
      re += `\\${c}`
    }
    else {
      re += c
    }
  }
  return new RegExp(`^${re}$`)
}

export function matchesAny(path: string, globs: string[]): boolean {
  return globs.some(g => globToRegExp(g).test(path))
}

// Classify a set of changed file paths (repo-relative).
//   - any risk-path match            → 'risk'
//   - else all paths are auto-paths  → 'chore'
//   - else                           → 'code'
export function classifyChange(paths: string[], policy: MergePolicy = DEFAULT_MERGE_POLICY): ChangeClass {
  if (paths.length === 0) return 'code' // empty/unknown diff is treated conservatively
  if (paths.some(p => matchesAny(p, policy.riskPaths))) return 'risk'
  if (paths.every(p => matchesAny(p, policy.autoPaths))) return 'chore'
  return 'code'
}

export interface MergeDecision {
  classification: ChangeClass
  // May the agent arm a merge at all (CI-green still enforced by branch protection)?
  autoMerge: boolean
  // Does a reviewer-agent approval gate the auto-merge?
  needsReview: boolean
  // Must a human approve (agent only opens the PR, then stops)?
  needsHuman: boolean
  reason: string
}

export function decideMerge(paths: string[], policy: MergePolicy = DEFAULT_MERGE_POLICY): MergeDecision {
  const classification = classifyChange(paths, policy)
  if (classification === 'risk') {
    return { classification, autoMerge: false, needsReview: false, needsHuman: true, reason: 'touches a risk path — human approval required' }
  }
  if (classification === 'chore') {
    return { classification, autoMerge: true, needsReview: false, needsHuman: false, reason: 'chore/docs only — auto-merge on green CI' }
  }
  return { classification, autoMerge: true, needsReview: true, needsHuman: false, reason: 'code change — auto-merge after reviewer-agent approval' }
}
