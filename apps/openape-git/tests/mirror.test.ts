import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mayDeleteMirrorRef, parseMirrorRefs, pushRefToMirror, redactToken, shouldMirrorRef } from '../server/utils/mirror'

const TOKEN = 'abcdef0123456789abcdef0123456789abcdef01'

describe('redactToken', () => {
  it('removes the token from what git echoed back', () => {
    // git prints the remote URL on failure, and that URL carries the token.
    // Without this the credential lands in mirror_pushes.error and in the UI.
    const stderr = `remote: rejected\nfatal: unable to access 'https://bot:${TOKEN}@git.example/o/r.git/': 403`
    const clean = redactToken(stderr, TOKEN)
    expect(clean).not.toContain(TOKEN)
    expect(clean).toContain('unable to access')
    expect(clean).toContain('git.example')
  })

  it('removes every occurrence, not just the first', () => {
    const clean = redactToken(`${TOKEN} and again ${TOKEN}`, TOKEN)
    expect(clean).not.toContain(TOKEN)
  })

  it('survives a token containing regex metacharacters', () => {
    const weird = 'a+b*c.d$e'
    expect(redactToken(`x ${weird} y`, weird)).not.toContain(weird)
  })

  it('leaves text alone when the token is empty', () => {
    expect(redactToken('nothing to hide', '')).toBe('nothing to hide')
  })
})

describe('shouldMirrorRef', () => {
  it('mirrors branches and tags', () => {
    expect(shouldMirrorRef('refs/heads/main')).toBe(true)
    expect(shouldMirrorRef('refs/tags/v1.0.0')).toBe(true)
  })

  it('leaves internal refs alone', () => {
    // Pull request head refs are ape-git's own bookkeeping; pushing them to
    // another forge would litter it with refs it cannot interpret.
    expect(shouldMirrorRef('refs/pull/7/head')).toBe(false)
    expect(shouldMirrorRef('refs/notes/commits')).toBe(false)
  })
})

describe('pushRefToMirror', () => {
  // git redacts credentials from its own messages, so a real failing push does
  // not exercise the redaction at all — an earlier version of this test passed
  // whether or not the code redacted anything. The runner is injected so the
  // one thing that matters can actually be asserted: whatever comes back from
  // git, the token does not reach the caller.
  const failingWith = (message: string) => () => Promise.reject(Object.assign(new Error('x'), { stderr: message }))

  it('keeps the token out of the error even when git echoes it back', async () => {
    const result = await pushRefToMirror(
      '/tmp',
      { url: 'https://git.example/o/r.git', username: 'bot', token: TOKEN },
      'refs/heads/main',
      failingWith(`fatal: unable to access 'https://bot:${TOKEN}@git.example/o/r.git/': 403`),
    )
    expect(result.ok).toBe(false)
    expect(result.error).not.toContain(TOKEN)
    expect(result.error).toContain('git.example')
  })

  it('keeps the token out of argv, where any process on the host could read it', async () => {
    // /proc/<pid>/cmdline is world-readable. A credential in the remote URL —
    // which is how this was first written — is visible to every process on the
    // machine for the lifetime of the push.
    let seen: { args: string[], env: NodeJS.ProcessEnv } | null = null
    await pushRefToMirror(
      '/tmp',
      { url: 'https://git.example/o/r.git', username: 'bot', token: TOKEN },
      'refs/heads/main',
      (args, _cwd, env) => { seen = { args, env }; return Promise.resolve({}) },
    )
    const call = seen as unknown as { args: string[], env: NodeJS.ProcessEnv }
    expect(call.args.join(' ')).not.toContain(TOKEN)
    expect(call.args).toContain('https://git.example/o/r.git')
    expect(call.env.APE_GIT_MIRROR_TOKEN).toBe(TOKEN)
    expect(call.env.GIT_TERMINAL_PROMPT).toBe('0')
  })

  it('reports success without an error field', async () => {
    const result = await pushRefToMirror(
      '/tmp',
      { url: 'https://git.example/o/r.git', username: 'bot', token: TOKEN },
      'refs/heads/main',
      () => Promise.resolve({}),
    )
    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()
  })
})

describe('pushRefToMirror against a real remote', () => {
  let root: string
  let src: string
  let remote: string
  const git = (cwd: string, args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@e.test' } })

  const noCreds = (url: string) => ({ url, username: '', token: '' })
  const headOf = (dir: string) => git(dir, ['log', '--format=%s', '-1']).trim()

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ape-git-m8-'))
    remote = join(root, 'remote.git')
    src = join(root, 'src')
    git(root, ['init', '-q', '--bare', '-b', 'main', 'remote.git'])
    git(root, ['init', '-q', '-b', 'main', 'src'])
    git(src, ['commit', '-q', '--allow-empty', '-m', 'first'])
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('replicates a ref to the far side', async () => {
    const result = await pushRefToMirror(src, noCreds(`file://${remote}`), 'refs/heads/main')
    expect(result.ok).toBe(true)
    expect(headOf(remote)).toBe('first')
  })

  it('replicates annotated tags and deletes only the expected target SHA', async () => {
    git(src, ['tag', '-a', 'v1', '-m', 'version 1'])
    const tagSha = git(src, ['rev-parse', 'refs/tags/v1']).trim()
    expect((await pushRefToMirror(src, noCreds(`file://${remote}`), 'refs/tags/v1', undefined, { sourceSha: tagSha, targetSha: null })).ok).toBe(true)
    expect(git(remote, ['rev-parse', 'refs/tags/v1']).trim()).toBe(tagSha)
    const refused = await pushRefToMirror(src, noCreds(`file://${remote}`), 'refs/tags/v1', undefined, { sourceSha: null, targetSha: 'a'.repeat(40) })
    expect(refused.ok).toBe(false)
    expect(git(remote, ['rev-parse', 'refs/tags/v1']).trim()).toBe(tagSha)
    const deleted = await pushRefToMirror(src, noCreds(`file://${remote}`), 'refs/tags/v1', undefined, { sourceSha: null, targetSha: tagSha })
    expect(deleted.ok).toBe(true)
    expect(git(remote, ['for-each-ref', 'refs/tags/v1']).trim()).toBe('')
  })

  it('fails and changes nothing when the far side has diverged', async () => {
    expect((await pushRefToMirror(src, noCreds(`file://${remote}`), 'refs/heads/main')).ok).toBe(true)
    // The situation this mirror cannot resolve and must not paper over:
    // someone pushed to the target directly. Without --force git refuses, and
    // the foreign commit has to survive.
    const other = join(root, 'other')
    git(root, ['clone', '-q', remote, 'other'])
    git(other, ['commit', '-q', '--allow-empty', '-m', 'written directly on the target'])
    git(other, ['push', '-q', 'origin', 'main'])
    git(src, ['commit', '-q', '--allow-empty', '-m', 'ours'])

    const result = await pushRefToMirror(src, noCreds(`file://${remote}`), 'refs/heads/main')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/rejected|fetch first/)
    expect(headOf(remote)).toBe('written directly on the target')
  })
})

describe('mirror reconciliation primitives', () => {
  it('preserves annotated tag object IDs and ignores peeled and internal refs', () => {
    const sha = 'a'.repeat(40)
    expect([...parseMirrorRefs(`${sha} refs/tags/v1\n${'b'.repeat(40)} refs/tags/v1^{}\n${sha} refs/pull/1/head`)]).toEqual([['refs/tags/v1', sha]])
  })
  it('refuses to delete an unknown or independently changed target', () => {
    expect(mayDeleteMirrorRef(null, 'a')).toBe(false)
    expect(mayDeleteMirrorRef('a', 'b')).toBe(false)
    expect(mayDeleteMirrorRef('a', 'a')).toBe(true)
    expect(mayDeleteMirrorRef('a', null)).toBe(true)
  })
})
