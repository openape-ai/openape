// Forge abstraction (M3): provider-agnostic PR/issue operations.
//
// Forges are NOT a closed enum baked into this library — that would lock
// out anyone on Bitbucket / GitLab / Gitea / a self-hosted forge. They
// are an open ADAPTER REGISTRY: GitHub (`gh`) and Azure DevOps (`az`)
// ship built-in; anyone can `registerForge()` another (or load one from
// recipe config). The actual CLIs are already shaped, so an adapter is
// just "how to recognise the remote + how to build the argv" — the gated
// ape-shell path executes it, no new gating machinery.
//
// Command-builders are pure (unit-tested). Free-text inputs (PR title/
// body) are shell-escaped via `shq`; structured inputs (branch, pr id)
// are charset-validated.

// A forge id — 'github' / 'azure' built-in, or any registered adapter.
export type Forge = string

const BRANCH_RE = /^[\w./-]{1,200}$/
const ID_RE = /^\d{1,12}$/

// POSIX-safe single-quote: wrap in '...' and replace any embedded
// single quote with '\'' . Makes arbitrary free text safe to pass
// through `bash -c`.
export function shq(s: string): string {
  return `'${String(s).replace(/'/g, '\'\\\'\'')}'`
}

export function assertBranch(v: unknown): string {
  if (typeof v !== 'string' || !BRANCH_RE.test(v)) {
    throw new Error('branch must match ^[A-Za-z0-9._/-]{1,200}$')
  }
  return v
}

export function assertId(v: unknown): string {
  if (typeof v !== 'string' && typeof v !== 'number') throw new Error('id required')
  const s = String(v)
  if (!ID_RE.test(s)) throw new Error('id must be a number')
  return s
}

export interface PrCreateInput {
  forge: Forge
  title: string
  body: string
  head: string // source branch
  base?: string // target branch (default: repo default)
}

export interface PrMergeInput {
  forge: Forge
  ref: string | number // GitHub: PR number or branch; others: PR/MR id
  auto?: boolean // arm "merge when checks pass" instead of immediate merge
  // Merge strategy is REPO policy, not ours. Only force squash when the
  // caller/recipe explicitly asks (squash:true); otherwise we add no
  // strategy flag and the forge/repo default applies.
  squash?: boolean
  deleteBranch?: boolean
}

// One forge's command vocabulary. Add a new forge by implementing this
// and calling registerForge(). `matchesRemote` decides auto-detection.
export interface ForgeAdapter {
  id: string
  matchesRemote: (remoteUrl: string) => boolean
  prCreate: (input: PrCreateInput) => string
  prMerge: (input: PrMergeInput) => string
  prStatus: (ref: string | number) => string
  issueGet: (ref: string | number) => string
}

// --- Built-in adapters ---

const githubAdapter: ForgeAdapter = {
  id: 'github',
  matchesRemote: url => /github\.com/i.test(url),
  prCreate: (i) => {
    const head = assertBranch(i.head)
    const parts = ['gh', 'pr', 'create', '--title', shq(i.title), '--body', shq(i.body), '--head', shq(head)]
    if (i.base !== undefined) parts.push('--base', shq(assertBranch(i.base)))
    return parts.join(' ')
  },
  prMerge: (i) => {
    const ref = String(i.ref)
    const refTok = ID_RE.test(ref) ? ref : assertBranch(ref)
    const parts = ['gh', 'pr', 'merge', shq(refTok)]
    if (i.squash === true) parts.push('--squash')
    if (i.auto) parts.push('--auto')
    if (i.deleteBranch) parts.push('--delete-branch')
    return parts.join(' ')
  },
  prStatus: (ref) => {
    const r = String(ref)
    const refTok = ID_RE.test(r) ? r : assertBranch(r)
    return `gh pr view ${shq(refTok)} --json state,mergeStateStatus,statusCheckRollup,reviewDecision`
  },
  issueGet: ref => `gh issue view ${assertId(ref)} --json number,title,body,labels`,
}

const azureAdapter: ForgeAdapter = {
  id: 'azure',
  matchesRemote: url => /dev\.azure\.com|visualstudio\.com/i.test(url),
  prCreate: (i) => {
    const head = assertBranch(i.head)
    const parts = ['az', 'repos', 'pr', 'create', '--title', shq(i.title), '--description', shq(i.body), '--source-branch', shq(head)]
    if (i.base !== undefined) parts.push('--target-branch', shq(assertBranch(i.base)))
    return parts.join(' ')
  },
  prMerge: (i) => {
    const id = assertId(i.ref)
    const parts = ['az', 'repos', 'pr', 'update', '--id', id]
    if (i.auto) parts.push('--auto-complete', 'true')
    else parts.push('--status', 'completed')
    if (i.squash === true) parts.push('--merge-commit-message-style', 'squash')
    if (i.deleteBranch) parts.push('--delete-source-branch', 'true')
    return parts.join(' ')
  },
  prStatus: ref => `az repos pr show --id ${assertId(ref)}`,
  issueGet: ref => `az boards work-item show --id ${assertId(ref)}`,
}

// --- Registry ---

const registry = new Map<string, ForgeAdapter>([
  [githubAdapter.id, githubAdapter],
  [azureAdapter.id, azureAdapter],
])

// Register (or override) a forge adapter — e.g. GitLab (`glab`), Gitea
// (`tea`), Bitbucket, or a self-hosted forge. Recipes can ship adapters
// so a team on any forge can use the coding agent.
export function registerForge(adapter: ForgeAdapter): void {
  registry.set(adapter.id, adapter)
}

export function listForges(): string[] {
  return [...registry.keys()]
}

export function getForge(id: string): ForgeAdapter {
  const a = registry.get(id)
  if (!a) {
    throw new Error(`unknown forge '${id}'. Registered: ${listForges().join(', ')}. Add one with registerForge().`)
  }
  return a
}

// Detect the forge from a git remote URL by asking each registered
// adapter. Throws a helpful error (not a hard 2-provider rejection) so
// the path to support a new forge is "register an adapter", not "patch
// this library".
export function detectForge(remoteUrl: unknown): Forge {
  if (typeof remoteUrl !== 'string' || remoteUrl === '') {
    throw new Error('remote URL required to detect forge')
  }
  for (const a of registry.values()) {
    if (a.matchesRemote(remoteUrl)) return a.id
  }
  throw new Error(`no forge adapter matches remote: ${remoteUrl}. Registered: ${listForges().join(', ')}. Register one with registerForge() (e.g. GitLab/Bitbucket/Gitea).`)
}

// --- Public command builders (delegate to the resolved adapter) ---

export function buildPrCreate(input: PrCreateInput): string {
  return getForge(input.forge).prCreate(input)
}

export function buildPrMerge(input: PrMergeInput): string {
  return getForge(input.forge).prMerge(input)
}

export function buildPrStatus(forge: Forge, ref: string | number): string {
  return getForge(forge).prStatus(ref)
}

export function buildIssueGet(forge: Forge, ref: string | number): string {
  return getForge(forge).issueGet(ref)
}

export const _internal = { shq, assertBranch, assertId, githubAdapter, azureAdapter, registry }
