import { createProblemError } from './problem'

export interface PrManifest {
  title: string
  /** Markdown. */
  description?: string
  author?: string
  authorAct: 'human' | 'agent'
  branch?: string
  baseSha?: string
  headSha?: string
  /** Raw unified diff (git diff output). */
  diff: string
}

const MAX_TEXT = 50_000
const MAX_DIFF = 5_000_000 // 5 MB of patch text
/** Asset paths: nested segments of [a-z0-9._-], no traversal, image extensions. */
export const ASSET_PATH = /^(?:[\w.-]+\/)*[\w.-]+\.(?:png|jpe?g|webp|gif)$/i

function asTrimmedString(value: unknown, field: string, opts: { required?: boolean, max?: number } = {}): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (opts.required) throw createProblemError({ status: 400, title: 'Invalid manifest', detail: `"${field}" is required.` })
    return undefined
  }
  if (typeof value !== 'string') {
    throw createProblemError({ status: 400, title: 'Invalid manifest', detail: `"${field}" must be a string.` })
  }
  const trimmed = value.trim()
  if (trimmed.length > (opts.max ?? MAX_TEXT)) {
    throw createProblemError({ status: 400, title: 'Invalid manifest', detail: `"${field}" exceeds ${opts.max ?? MAX_TEXT} characters.` })
  }
  return trimmed
}

/**
 * Validate an uploaded PR manifest. Throws RFC 7807-style 400s with a
 * field-level detail on any violation.
 */
export function validatePrManifest(raw: unknown): PrManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw createProblemError({ status: 400, title: 'Invalid manifest', detail: 'Body must be a JSON object.' })
  }
  const m = raw as Record<string, unknown>
  const title = asTrimmedString(m.title, 'title', { required: true, max: 300 })!
  const description = asTrimmedString(m.description, 'description')
  const author = asTrimmedString(m.author, 'author', { max: 200 })
  const branch = asTrimmedString(m.branch, 'branch', { max: 300 })
  const baseSha = asTrimmedString(m.baseSha, 'baseSha', { max: 64 })
  const headSha = asTrimmedString(m.headSha, 'headSha', { max: 64 })
  const diff = asTrimmedString(m.diff, 'diff', { required: true, max: MAX_DIFF })!

  let authorAct: 'human' | 'agent' = 'agent'
  if (m.authorAct !== undefined) {
    if (m.authorAct !== 'human' && m.authorAct !== 'agent') {
      throw createProblemError({ status: 400, title: 'Invalid manifest', detail: '"authorAct" must be "human" or "agent".' })
    }
    authorAct = m.authorAct
  }

  return { title, description, author, authorAct, branch, baseSha, headSha, diff }
}

export interface DiffStats {
  files: number
  additions: number
  deletions: number
}

/**
 * Count changed files and added/removed lines from a unified diff.
 * Hunk markers and file headers are excluded so only real content lines count.
 */
export function diffStats(diff: string): DiffStats {
  let files = 0
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) files++
    else if (line.startsWith('+++') || line.startsWith('---')) continue
    else if (line.startsWith('+')) additions++
    else if (line.startsWith('-')) deletions++
  }
  // Fall back to counting "+++ " file headers when there are no "diff --git"
  // lines (e.g. a plain `diff -u` without git wrapper).
  if (files === 0) {
    files = diff.split('\n').filter(l => l.startsWith('+++ ')).length
  }
  return { files, additions, deletions }
}
