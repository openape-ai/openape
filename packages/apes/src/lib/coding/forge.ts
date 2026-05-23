// Forge abstraction (M3): provider-agnostic PR/issue operations over
// GitHub (`gh`) and Azure DevOps (`az`). The actual CLIs are already
// shaped, so these command-builders just produce the argv that the
// gated ape-shell path executes — no new gating machinery.
//
// Command-builders are pure (unit-tested). Free-text inputs (PR title/
// body) are shell-escaped via `shq`; structured inputs (branch, pr id)
// are charset-validated.

export type Forge = 'github' | 'azure'

const BRANCH_RE = /^[\w./-]{1,200}$/
const ID_RE = /^\d{1,12}$/

// POSIX-safe single-quote: wrap in '...' and replace any embedded
// single quote with '\'' . Makes arbitrary free text safe to pass
// through `bash -c`.
export function shq(s: string): string {
  return `'${String(s).replace(/'/g, '\'\\\'\'')}'`
}

function assertBranch(v: unknown): string {
  if (typeof v !== 'string' || !BRANCH_RE.test(v)) {
    throw new Error('branch must match ^[A-Za-z0-9._/-]{1,200}$')
  }
  return v
}

function assertId(v: unknown): string {
  if (typeof v !== 'string' && typeof v !== 'number') throw new Error('id required')
  const s = String(v)
  if (!ID_RE.test(s)) throw new Error('id must be a number')
  return s
}

// Detect the forge from a git remote URL.
//   github.com/...                     → github
//   dev.azure.com/... | *.visualstudio.com → azure
export function detectForge(remoteUrl: unknown): Forge {
  if (typeof remoteUrl !== 'string' || remoteUrl === '') {
    throw new Error('remote URL required to detect forge')
  }
  if (/github\.com/i.test(remoteUrl)) return 'github'
  if (/dev\.azure\.com|visualstudio\.com/i.test(remoteUrl)) return 'azure'
  throw new Error(`unsupported forge for remote: ${remoteUrl}`)
}

export interface PrCreateInput {
  forge: Forge
  title: string
  body: string
  head: string // source branch
  base?: string // target branch (default: repo default)
}

export function buildPrCreate(input: PrCreateInput): string {
  const head = assertBranch(input.head)
  const base = input.base !== undefined ? assertBranch(input.base) : undefined
  if (input.forge === 'github') {
    const parts = ['gh', 'pr', 'create', '--title', shq(input.title), '--body', shq(input.body), '--head', shq(head)]
    if (base) parts.push('--base', shq(base))
    return parts.join(' ')
  }
  // azure
  const parts = ['az', 'repos', 'pr', 'create', '--title', shq(input.title), '--description', shq(input.body), '--source-branch', shq(head)]
  if (base) parts.push('--target-branch', shq(base))
  return parts.join(' ')
}

export interface PrMergeInput {
  forge: Forge
  // GitHub: PR number or branch; Azure: PR id.
  ref: string | number
  // When true, arm "merge when checks pass" instead of immediate merge.
  auto?: boolean
  squash?: boolean
  deleteBranch?: boolean
}

export function buildPrMerge(input: PrMergeInput): string {
  if (input.forge === 'github') {
    // ref may be a numeric PR or a branch name.
    const ref = String(input.ref)
    const refTok = ID_RE.test(ref) ? ref : assertBranch(ref)
    const parts = ['gh', 'pr', 'merge', shq(refTok)]
    if (input.squash !== false) parts.push('--squash')
    if (input.auto) parts.push('--auto')
    if (input.deleteBranch) parts.push('--delete-branch')
    return parts.join(' ')
  }
  // azure: complete the PR. auto-complete is the "--auto" analogue.
  const id = assertId(input.ref)
  const parts = ['az', 'repos', 'pr', 'update', '--id', id]
  if (input.auto) parts.push('--auto-complete', 'true')
  else parts.push('--status', 'completed')
  if (input.squash !== false) parts.push('--merge-commit-message-style', 'squash')
  if (input.deleteBranch) parts.push('--delete-source-branch', 'true')
  return parts.join(' ')
}

export function buildPrStatus(forge: Forge, ref: string | number): string {
  if (forge === 'github') {
    const r = String(ref)
    const refTok = ID_RE.test(r) ? r : assertBranch(r)
    return `gh pr view ${shq(refTok)} --json state,mergeStateStatus,statusCheckRollup,reviewDecision`
  }
  return `az repos pr show --id ${assertId(ref)}`
}

export function buildIssueGet(forge: Forge, ref: string | number): string {
  if (forge === 'github') {
    return `gh issue view ${assertId(ref)} --json number,title,body,labels`
  }
  return `az boards work-item show --id ${assertId(ref)}`
}

export const _internal = { shq, assertBranch, assertId }
