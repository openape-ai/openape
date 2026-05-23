// Merge policy (M5): classify a PR's changed files and decide how it
// may be merged, per the B+C-Overlay policy:
//   - chore (docs/changeset/etc.) → auto-merge on green CI
//   - code                        → auto-merge after reviewer-agent approval
//   - risk (auth/migrations/...)  → human approval required, never auto
//
// IMPORTANT: this library ships NO opinionated path lists. Risk/auto
// globs are NOT a property of a generic library — they belong to the
// target repo (`.openape/coding.json`), which travels with the code it
// protects, is owned by that repo's team, and is versioned alongside
// it. The smart sources are signals that already exist (deploy-workflow
// `paths:` filters = the real prod-risk surface; CODEOWNERS; branch-
// protection required reviewers) — see loadMergePolicy + the
// derive-from-signals follow-up. Hand-maintained parallel lists rot.
//
// Secure by default: with no configured policy, `autoMergeEnabled` is
// false → nothing auto-merges, every change needs a human. Auto-merge
// is opt-in, declared per-repo, not a guess baked into this package.
//
// Pure + unit-tested. The CI-green check is enforced server-side by
// branch protection; this layer only governs whether the agent may ARM
// the merge and which review gate applies.

export type ChangeClass = 'chore' | 'code' | 'risk'

export interface MergePolicy {
  // Master switch. False (default) = secure: never auto-merge, every
  // change is handed to a human until the repo opts in.
  autoMergeEnabled: boolean
  // Globs that mark a path as low-risk chore (auto-merge candidate).
  autoPaths: string[]
  // Globs that mark a path as risky (force human review). Highest precedence.
  riskPaths: string[]
}

// Secure fallback used when a repo has no `.openape/coding.json`. No
// path opinions; auto-merge disabled.
export const SECURE_DEFAULT_POLICY: MergePolicy = {
  autoMergeEnabled: false,
  autoPaths: [],
  riskPaths: [],
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
export function classifyChange(paths: string[], policy: MergePolicy = SECURE_DEFAULT_POLICY): ChangeClass {
  if (paths.length === 0) return 'code' // empty/unknown diff is treated conservatively
  if (paths.some(p => matchesAny(p, policy.riskPaths))) return 'risk'
  if (policy.autoPaths.length > 0 && paths.every(p => matchesAny(p, policy.autoPaths))) return 'chore'
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

export function decideMerge(paths: string[], policy: MergePolicy = SECURE_DEFAULT_POLICY): MergeDecision {
  const classification = classifyChange(paths, policy)
  // Master switch off → secure default: nothing auto-merges, hand to a
  // human. The repo must opt in via `.openape/coding.json` to enable any
  // automation.
  if (!policy.autoMergeEnabled) {
    return { classification, autoMerge: false, needsReview: false, needsHuman: true, reason: 'auto-merge not enabled for this repo — human approval required (set autoMergeEnabled in .openape/coding.json to opt in)' }
  }
  if (classification === 'risk') {
    return { classification, autoMerge: false, needsReview: false, needsHuman: true, reason: 'touches a risk path — human approval required' }
  }
  if (classification === 'chore') {
    return { classification, autoMerge: true, needsReview: false, needsHuman: false, reason: 'chore/docs only — auto-merge on green CI' }
  }
  return { classification, autoMerge: true, needsReview: true, needsHuman: false, reason: 'code change — auto-merge after reviewer-agent approval' }
}

// Load the merge policy for a worktree from `<dir>/.openape/coding.json`
// (the `mergePolicy` key). Missing/invalid → secure default. This keeps
// the policy with the repo it governs, never in this package. A future
// step derives sensible globs from existing signals (deploy-workflow
// `paths:` filters, CODEOWNERS) when the file is absent — see plan.
export async function loadMergePolicy(worktreeDir: string): Promise<MergePolicy> {
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  try {
    const raw = await readFile(join(worktreeDir, '.openape', 'coding.json'), 'utf8')
    const parsed = JSON.parse(raw) as { mergePolicy?: Partial<MergePolicy> }
    const mp = parsed.mergePolicy
    if (!mp) return SECURE_DEFAULT_POLICY
    return {
      autoMergeEnabled: mp.autoMergeEnabled === true,
      autoPaths: Array.isArray(mp.autoPaths) ? mp.autoPaths.filter(g => typeof g === 'string') : [],
      riskPaths: Array.isArray(mp.riskPaths) ? mp.riskPaths.filter(g => typeof g === 'string') : [],
    }
  }
  catch {
    return SECURE_DEFAULT_POLICY
  }
}
