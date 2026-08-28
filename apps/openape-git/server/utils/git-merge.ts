import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// Write-side git plumbing for pull requests (plan M6). Everything a PR shows
// is computed here from the repo itself — diff, mergeability, merge commit —
// so the database only ever holds the ref pair and the review metadata.
//
// The merge happens without a worktree: merge-tree writes the merged tree,
// commit-tree turns it into a commit with the merging identity, update-ref
// moves the branch with a compare-and-swap against the sha we merged from.

const run = promisify(execFile)

const MAX_BUFFER = 20 * 1024 * 1024

/** Merge commit subject, in the shape `git log --oneline` readers expect. */
export function mergeMessage(number: number, title: string, source: string, target: string): string {
  return `Merge pull request #${number} from ${source} into ${target}\n\n${title}\n`
}

export interface MergePreview {
  mergeable: boolean
  tree: string | null
  conflicts: string[]
}

/** Common ancestor of two commits, or null for unrelated histories. */
export async function mergeBase(dir: string, target: string, source: string): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', dir, 'merge-base', '--end-of-options', target, source])
    return stdout.trim() || null
  }
  catch {
    return null
  }
}

/**
 * The patch a PR proposes: `git diff target...source`, i.e. what source added
 * since the branches diverged — not the difference between the two tips.
 */
export async function diffPatch(dir: string, target: string, source: string, maxBytes: number): Promise<{ patch: string, truncated: boolean }> {
  const { stdout } = await run(
    'git',
    ['-C', dir, 'diff', '--no-color', '--find-renames', '--end-of-options', `${target}...${source}`],
    { maxBuffer: MAX_BUFFER },
  )
  return stdout.length > maxBytes
    ? { patch: stdout.slice(0, maxBytes), truncated: true }
    : { patch: stdout, truncated: false }
}

/** Paths in `git merge-tree --write-tree` conflict output (`<mode> <oid> <stage>\t<path>`). */
export function parseConflicts(stdout: string): string[] {
  const paths = new Set<string>()
  for (const line of stdout.split('\n').slice(1)) {
    const tab = line.indexOf('\t')
    if (tab === -1 || !/^\d{6} [0-9a-f]{40} [123]$/.test(line.slice(0, tab))) continue
    paths.add(line.slice(tab + 1))
  }
  return [...paths]
}

/**
 * Can this merge run cleanly? merge-tree does the whole merge in the object
 * database and exits non-zero on conflict; the tree it wrote is exactly the
 * tree the merge commit gets, so a successful preview is the merge.
 */
export async function mergePreview(dir: string, target: string, source: string): Promise<MergePreview> {
  try {
    const { stdout } = await run('git', ['-C', dir, 'merge-tree', '--write-tree', '--end-of-options', target, source])
    return { mergeable: true, tree: stdout.split('\n')[0]?.trim() ?? null, conflicts: [] }
  }
  catch (err) {
    const { stdout, code } = err as { stdout?: string, code?: number }
    // Exit 1 = conflicts (with output); anything else is a real failure, e.g.
    // unrelated histories — both mean "not mergeable", only one has paths.
    return { mergeable: false, tree: null, conflicts: code === 1 ? parseConflicts(stdout ?? '') : [] }
  }
}

export interface MergeIdentity {
  name: string
  email: string
}

/**
 * Create the merge commit and fast-forward-safely move the target branch.
 * `expectedTarget` makes the ref update a compare-and-swap: if the branch
 * moved between preview and merge, the update fails instead of clobbering.
 */
export async function createMergeCommit(dir: string, options: {
  tree: string
  target: string
  source: string
  targetRef: string
  expectedTarget: string
  message: string
  identity: MergeIdentity
}): Promise<string> {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: options.identity.name,
    GIT_AUTHOR_EMAIL: options.identity.email,
    GIT_COMMITTER_NAME: options.identity.name,
    GIT_COMMITTER_EMAIL: options.identity.email,
  }
  const { stdout } = await run(
    'git',
    ['-C', dir, 'commit-tree', options.tree, '-p', options.target, '-p', options.source, '-m', options.message],
    { env },
  )
  const sha = stdout.trim()
  await run('git', ['-C', dir, 'update-ref', options.targetRef, sha, options.expectedTarget])
  return sha
}
