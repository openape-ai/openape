import { describe, expect, it } from 'vitest'
import {
  findReadme,
  isMarkdownPath,
  isValidRef,
  isValidTreePath,
  langFromPath,
  looksBinary,
  parseBranches,
  parseCommits,
  parseTreeEntries,
} from '../server/utils/git-parse'

describe('isValidRef', () => {
  it('accepts branch names, tags and shas', () => {
    expect(isValidRef('main')).toBe(true)
    expect(isValidRef('feat/issue-1327-m3')).toBe(true)
    expect(isValidRef('v1.2.3')).toBe(true)
    expect(isValidRef('a'.repeat(40))).toBe(true)
  })

  it('rejects option look-alikes, ranges and reflog syntax', () => {
    expect(isValidRef('')).toBe(false)
    expect(isValidRef('-D')).toBe(false)
    expect(isValidRef('--exec=evil')).toBe(false)
    expect(isValidRef('main..dev')).toBe(false)
    expect(isValidRef('main@{1}')).toBe(false)
    expect(isValidRef('a b')).toBe(false)
  })
})

describe('isValidTreePath', () => {
  it('accepts nested relative paths', () => {
    expect(isValidTreePath('README.md')).toBe(true)
    expect(isValidTreePath('src/app/pages/index.vue')).toBe(true)
    expect(isValidTreePath('a-b_c.d/e')).toBe(true)
  })

  it('rejects traversal, absolute and empty-segment paths', () => {
    expect(isValidTreePath('../etc/passwd')).toBe(false)
    expect(isValidTreePath('a/../b')).toBe(false)
    expect(isValidTreePath('/etc')).toBe(false)
    expect(isValidTreePath('a//b')).toBe(false)
    expect(isValidTreePath('a/')).toBe(false)
    expect(isValidTreePath('a/./b')).toBe(false)
    expect(isValidTreePath('a\0b')).toBe(false)
  })
})

describe('parseTreeEntries', () => {
  const out = [
    '100644 blob 1111111111111111111111111111111111111111     129\tREADME.md',
    '040000 tree 2222222222222222222222222222222222222222       -\tsrc',
    '100644 blob 3333333333333333333333333333333333333333      42\tapp config.ts',
  ].join('\0')

  it('parses entries, keeps names with spaces, sorts trees first', () => {
    const entries = parseTreeEntries(`${out}\0`)
    expect(entries.map(e => e.name)).toEqual(['src', 'app config.ts', 'README.md'])
    expect(entries[0]).toEqual({ name: 'src', type: 'tree', size: null })
    expect(entries[2]).toEqual({ name: 'README.md', type: 'blob', size: 129 })
  })

  it('returns [] for empty output', () => {
    expect(parseTreeEntries('')).toEqual([])
  })
})

describe('parseCommits', () => {
  it('parses NUL-separated fields and RS-separated records', () => {
    const record = (fields: string[]) => `${fields.join('\0')}\x1E`
    const out = `${record(['abc123', 'Patrick', 'p@example.com', '1756', 'fix: thing'])}\n${record(['def456', 'Agent', 'a@example.com', '1700', 'feat: other'])}\n`
    const commits = parseCommits(out)
    expect(commits).toHaveLength(2)
    expect(commits[0]).toEqual({ sha: 'abc123', author: 'Patrick', email: 'p@example.com', date: 1756, subject: 'fix: thing' })
    expect(commits[1]!.subject).toBe('feat: other')
  })
})

describe('parseBranches', () => {
  it('parses and sorts newest first', () => {
    const line = (fields: string[]) => fields.join('\0')
    const out = `${line(['main', 'aaa', '1000', 'init'])}\n${line(['feat/x', 'bbb', '2000', 'wip'])}\n`
    const branches = parseBranches(out)
    expect(branches.map(b => b.name)).toEqual(['feat/x', 'main'])
    expect(branches[1]).toEqual({ name: 'main', sha: 'aaa', date: 1000, subject: 'init' })
  })
})

describe('looksBinary', () => {
  it('detects NUL bytes and passes text', () => {
    expect(looksBinary(Buffer.from('hello\0world'))).toBe(true)
    expect(looksBinary(Buffer.from('plain text ünïcode'))).toBe(false)
  })
})

describe('langFromPath', () => {
  it('maps extensions and special basenames', () => {
    expect(langFromPath('src/index.ts')).toBe('typescript')
    expect(langFromPath('App.vue')).toBe('vue')
    expect(langFromPath('Dockerfile')).toBe('dockerfile')
    expect(langFromPath('.gitignore')).toBe('text')
    expect(langFromPath('weird.xyz')).toBe('text')
    expect(langFromPath('noext')).toBe('text')
  })

  it('flags markdown paths', () => {
    expect(isMarkdownPath('README.md')).toBe(true)
    expect(isMarkdownPath('docs/guide.markdown')).toBe(true)
    expect(isMarkdownPath('index.ts')).toBe(false)
  })
})

describe('findReadme', () => {
  it('prefers README.md, falls back to bare README, ignores dirs', () => {
    expect(findReadme([
      { name: 'README', type: 'blob', size: 1 },
      { name: 'readme.md', type: 'blob', size: 2 },
    ])!.name).toBe('readme.md')
    expect(findReadme([{ name: 'README', type: 'blob', size: 1 }])!.name).toBe('README')
    expect(findReadme([{ name: 'README.md', type: 'tree', size: null }])).toBeNull()
    expect(findReadme([])).toBeNull()
  })
})
