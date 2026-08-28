import type { BranchInfo, CommitInfo, TreeEntry } from './git-parse'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseBranches, parseCommits, parseTreeEntries } from './git-parse'

// Read-only git plumbing for the browsing endpoints. Every call goes through
// execFile (no shell); refs and paths are validated by the endpoints before
// they get here, and paths only ever appear after `<sha>:` inside a single
// argument, so they can never read as options.

const run = promisify(execFile)

// Packfile-sized reads never happen here (cat-file of one blob at most);
// 10 MB covers any file we are willing to render.
const MAX_BUFFER = 10 * 1024 * 1024

/** Commit sha for a ref, or null when the ref doesn't resolve (e.g. empty repo). */
export async function resolveCommit(dir: string, ref: string): Promise<string | null> {
  try {
    const { stdout } = await run(
      'git',
      ['-C', dir, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
    )
    return stdout.trim() || null
  }
  catch {
    return null
  }
}

export async function listBranches(dir: string): Promise<BranchInfo[]> {
  const { stdout } = await run('git', [
    '-C',
    dir,
    'for-each-ref',
    '--format=%(refname:short)%00%(objectname)%00%(committerdate:unix)%00%(subject)',
    'refs/heads',
  ])
  return parseBranches(stdout)
}

export async function listCommits(dir: string, sha: string, limit: number): Promise<CommitInfo[]> {
  const { stdout } = await run(
    'git',
    ['-C', dir, 'log', `-n`, String(limit), '--format=%H%x00%an%x00%ae%x00%at%x00%s%x1e', sha, '--'],
    { maxBuffer: MAX_BUFFER },
  )
  return parseCommits(stdout)
}

/** Object type at `<sha>:<path>`, or null when the path doesn't exist. */
export async function objectType(dir: string, spec: string): Promise<'commit' | 'tree' | 'blob' | null> {
  try {
    const { stdout } = await run('git', ['-C', dir, 'cat-file', '-t', spec])
    const type = stdout.trim()
    return type === 'commit' || type === 'tree' || type === 'blob' ? type : null
  }
  catch {
    return null
  }
}

export async function listTree(dir: string, spec: string): Promise<TreeEntry[]> {
  const { stdout } = await run('git', ['-C', dir, 'ls-tree', '-z', '-l', spec], { maxBuffer: MAX_BUFFER })
  return parseTreeEntries(stdout)
}

export async function readBlob(dir: string, spec: string): Promise<Buffer> {
  const { stdout } = await run(
    'git',
    ['-C', dir, 'cat-file', 'blob', spec],
    { maxBuffer: MAX_BUFFER, encoding: 'buffer' },
  )
  return stdout
}

export async function blobSize(dir: string, spec: string): Promise<number> {
  const { stdout } = await run('git', ['-C', dir, 'cat-file', '-s', spec])
  return Number.parseInt(stdout.trim())
}
