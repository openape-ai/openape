// Pure parsing/validation for the read-only browsing endpoints. Everything
// here is testable without a git binary; the execFile wrappers live in
// git-read.ts.

export interface TreeEntry {
  name: string
  type: 'tree' | 'blob'
  size: number | null
}

export interface CommitInfo {
  sha: string
  author: string
  email: string
  date: number
  subject: string
}

export interface BranchInfo {
  name: string
  sha: string
  date: number
  subject: string
}

/**
 * Refs we accept from the URL: branch names, tags, shas. Rejects anything
 * that could read as a git option (leading dash), path escapes, or revision
 * range/exclusion syntax — the ref is passed as a single execFile argument,
 * so this is defense in depth, not shell escaping.
 */
export function isValidRef(ref: string): boolean {
  if (ref.length === 0 || ref.length > 200) return false
  if (ref.includes('..') || ref.includes('@{')) return false
  return /^\w[\w./-]*$/.test(ref)
}

/** Full commit sha as it appears in webhook payloads and status reports. */
export function isValidSha(sha: string): boolean {
  return /^[0-9a-f]{40}$/.test(sha)
}

/** Tree paths from the URL: relative, no traversal, no NUL, no option look-alikes. */
export function isValidTreePath(path: string): boolean {
  if (path.length > 4096 || path.includes('\0')) return false
  if (path.startsWith('/') || path.endsWith('/')) return false
  return path.split('/').every(seg => seg.length > 0 && seg !== '.' && seg !== '..')
}

/** Parse `git ls-tree -z -l <tree-ish>` output. */
export function parseTreeEntries(out: string): TreeEntry[] {
  const entries: TreeEntry[] = []
  for (const record of out.split('\0')) {
    if (!record) continue
    const tab = record.indexOf('\t')
    if (tab === -1) continue
    const [, type, , size] = record.slice(0, tab).split(/\s+/)
    if (type !== 'tree' && type !== 'blob') continue
    entries.push({
      name: record.slice(tab + 1),
      type,
      size: size === '-' || size === undefined ? null : Number.parseInt(size),
    })
  }
  // Directories first, then files, each alphabetically — the reading order of
  // every forge UI.
  return entries.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'tree' ? -1 : 1)
}

/** Parse `git log --format=%H%x00%an%x00%ae%x00%at%x00%s%x1e` output. */
export function parseCommits(out: string): CommitInfo[] {
  const commits: CommitInfo[] = []
  for (const record of out.split('\x1E')) {
    const [sha, author, email, date, subject] = record.replace(/^\n/, '').split('\0')
    if (!sha || !author || date === undefined) continue
    commits.push({ sha, author, email: email ?? '', date: Number.parseInt(date), subject: subject ?? '' })
  }
  return commits
}

/** Parse `git for-each-ref --format=%(refname:short)%00%(objectname)%00%(committerdate:unix)%00%(subject)` output. */
export function parseBranches(out: string): BranchInfo[] {
  const branches: BranchInfo[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const [name, sha, date, subject] = line.split('\0')
    if (!name || !sha) continue
    branches.push({ name, sha, date: Number.parseInt(date ?? '0'), subject: subject ?? '' })
  }
  return branches.sort((a, b) => b.date - a.date)
}

/** Same heuristic git itself uses: a NUL byte early in the file means binary. */
export function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0)
}

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  vue: 'vue',
  json: 'json',
  jsonc: 'jsonc',
  json5: 'json5',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  css: 'css',
  scss: 'scss',
  html: 'html',
  xml: 'xml',
  svg: 'xml',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sql: 'sql',
  graphql: 'graphql',
  prisma: 'prisma',
  tf: 'hcl',
  ini: 'ini',
  txt: 'text',
}

const LANG_BY_BASENAME: Record<string, string> = {
  'dockerfile': 'dockerfile',
  'makefile': 'makefile',
  '.gitignore': 'text',
  '.npmrc': 'ini',
  '.env': 'ini',
}

/** Shiki language for a file path; 'text' when we don't know better. */
export function langFromPath(path: string): string {
  const base = (path.split('/').pop() ?? '').toLowerCase()
  const fromBase = LANG_BY_BASENAME[base]
  if (fromBase) return fromBase
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return 'text'
  return LANG_BY_EXT[base.slice(dot + 1)] ?? 'text'
}

/** True for files the browse endpoint renders as markdown instead of code. */
export function isMarkdownPath(path: string): boolean {
  return langFromPath(path) === 'markdown'
}

/** The entry a tree listing should render as its README, if any. */
export function findReadme(entries: TreeEntry[]): TreeEntry | null {
  return entries.find(e => e.type === 'blob' && /^readme\.(?:md|markdown)$/i.test(e.name))
    ?? entries.find(e => e.type === 'blob' && /^readme$/i.test(e.name))
    ?? null
}

// --- Pull requests (M6) -----------------------------------------------------

export interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk'
  text: string
  oldLine: number | null
  newLine: number | null
}

export interface DiffFile {
  path: string
  oldPath: string | null
  binary: boolean
  additions: number
  deletions: number
  lines: DiffLine[]
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Unified diff -> files with line numbers. Only the new-side line number is
 * needed to anchor a comment, but both are kept so the view can show them.
 * Anything git prints that is not a hunk line (index/mode/similarity headers)
 * is dropped: the file header already carries the path.
 */
export function parsePatch(patch: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let oldLine = 0
  let newLine = 0

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const match = raw.match(/^diff --git a\/(.+) b\/(.+)$/)
      file = {
        path: match?.[2] ?? raw.slice('diff --git '.length),
        oldPath: match && match[1] !== match[2] ? match[1]! : null,
        binary: false,
        additions: 0,
        deletions: 0,
        lines: [],
      }
      files.push(file)
      continue
    }
    if (!file) continue
    if (raw.startsWith('Binary files ') || raw.startsWith('GIT binary patch')) {
      file.binary = true
      continue
    }
    const hunk = raw.match(HUNK_HEADER)
    if (hunk) {
      oldLine = Number.parseInt(hunk[1]!)
      newLine = Number.parseInt(hunk[2]!)
      file.lines.push({ type: 'hunk', text: raw, oldLine: null, newLine: null })
      continue
    }
    if (file.lines.length === 0) continue // still in the file header
    if (raw.startsWith('+')) {
      file.additions++
      file.lines.push({ type: 'add', text: raw.slice(1), oldLine: null, newLine: newLine++ })
    }
    else if (raw.startsWith('-')) {
      file.deletions++
      file.lines.push({ type: 'del', text: raw.slice(1), oldLine: oldLine++, newLine: null })
    }
    else if (raw.startsWith(' ')) {
      file.lines.push({ type: 'ctx', text: raw.slice(1), oldLine: oldLine++, newLine: newLine++ })
    }
    // '\ No newline at end of file' and the trailing empty element fall through
  }
  return files
}
