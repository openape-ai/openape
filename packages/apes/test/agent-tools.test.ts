import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { asOpenAiTools, taskTools, TOOLS } from '../src/lib/agent-tools'
import { _internal as fileInternal } from '../src/lib/agent-tools/file'
import { _internal as wtInternal } from '../src/lib/agent-tools/git-worktree'

describe('tool registry', () => {
  it('TOOLS has the expected keys', () => {
    for (const name of ['time.now', 'http.get', 'http.post', 'file.read', 'file.write', 'edit_file', 'tasks.list', 'tasks.create', 'mail.list', 'mail.search', 'bash', 'git_worktree']) {
      expect(TOOLS[name]).toBeDefined()
    }
  })

  it('taskTools resolves names to definitions', () => {
    const t = taskTools(['time.now'])
    expect(t).toHaveLength(1)
    expect(t[0]?.name).toBe('time.now')
  })

  it('taskTools throws on unknown names', () => {
    expect(() => taskTools(['time.now', 'magic.do'])).toThrow(/unknown tool/)
  })

  it('asOpenAiTools strips execute and wire-encodes the name (dots → underscores)', () => {
    const out = asOpenAiTools([TOOLS['time.now']!])
    expect(out[0]).toEqual({
      type: 'function',
      // ChatGPT's Responses API enforces ^[a-zA-Z0-9_-]+$ on tool names
      // — dot-bearing catalog names get wire-encoded to underscores.
      function: expect.objectContaining({ name: 'time_now' }),
    })
    expect((out[0]!.function as Record<string, unknown>).execute).toBeUndefined()
  })
})

describe('bash tool', () => {
  it('rejects empty + non-string cmd before spawning anything', async () => {
    const bash = TOOLS.bash!
    await expect(bash.execute({})).rejects.toThrow(/cmd must be a non-empty string/)
    await expect(bash.execute({ cmd: '' })).rejects.toThrow(/cmd must be a non-empty string/)
    await expect(bash.execute({ cmd: '   ' })).rejects.toThrow(/cmd must be a non-empty string/)
    await expect(bash.execute({ cmd: 42 as unknown as string })).rejects.toThrow(/cmd must be a non-empty string/)
  })

  it('declares cmd as the only required parameter', () => {
    const params = TOOLS.bash!.parameters as { properties: Record<string, unknown>, required: string[] }
    expect(params.required).toEqual(['cmd'])
    expect(params.properties.cmd).toBeDefined()
    expect(params.properties.timeout_ms).toBeDefined()
  })
})

describe('time.now', () => {
  it('returns iso, epoch_seconds, timezone offset', async () => {
    const result = await TOOLS['time.now']!.execute({}) as Record<string, unknown>
    expect(typeof result.iso).toBe('string')
    expect(typeof result.epoch_seconds).toBe('number')
    expect(typeof result.timezone_offset_minutes).toBe('number')
  })
})

describe('file tool jail', () => {
  it('rejects path traversal via ../', () => {
    expect(() => fileInternal.jailPath('../etc/passwd')).toThrow(/outside the agent's home/)
  })

  it('rejects absolute paths outside $HOME', () => {
    expect(() => fileInternal.jailPath('/etc/passwd')).toThrow(/outside the agent's home/)
  })

  it('accepts paths inside $HOME', () => {
    expect(fileInternal.jailPath('Documents/notes.md')).toBe(`${homedir()}/Documents/notes.md`)
    expect(fileInternal.jailPath('~/Documents/notes.md')).toBe(`${homedir()}/Documents/notes.md`)
  })

  it('rejects empty + non-string paths', () => {
    expect(() => fileInternal.jailPath('')).toThrow()
    expect(() => fileInternal.jailPath(123 as unknown as string)).toThrow()
  })
})

describe('edit_file', () => {
  function withTempFile(body: string, fn: (rel: string, abs: string) => Promise<void> | void) {
    const dir = mkdtempSync(join(homedir(), '.apes-edit-test-'))
    const abs = join(dir, 'f.txt')
    writeFileSync(abs, body, 'utf8')
    const rel = abs.slice(homedir().length + 1) // path relative to $HOME
    return Promise.resolve(fn(rel, abs)).finally(() => rmSync(dir, { recursive: true, force: true }))
  }

  it('replaces a unique substring', async () => {
    await withTempFile('hello world\n', async (rel, abs) => {
      const r = await TOOLS.edit_file!.execute({ path: rel, old_string: 'world', new_string: 'there' }) as Record<string, unknown>
      expect(r.replacements).toBe(1)
      expect(readFileSync(abs, 'utf8')).toBe('hello there\n')
    })
  })

  it('errors when old_string is absent', async () => {
    await withTempFile('abc', async (rel) => {
      await expect(TOOLS.edit_file!.execute({ path: rel, old_string: 'xyz', new_string: 'q' })).rejects.toThrow(/not found/)
    })
  })

  it('errors on ambiguous match unless replace_all', async () => {
    await withTempFile('a a a', async (rel, abs) => {
      await expect(TOOLS.edit_file!.execute({ path: rel, old_string: 'a', new_string: 'b' })).rejects.toThrow(/occurs 3 times/)
      const r = await TOOLS.edit_file!.execute({ path: rel, old_string: 'a', new_string: 'b', replace_all: true }) as Record<string, unknown>
      expect(r.replacements).toBe(3)
      expect(readFileSync(abs, 'utf8')).toBe('b b b')
    })
  })

  it('rejects identical old/new and out-of-home paths', async () => {
    await expect(TOOLS.edit_file!.execute({ path: 'x', old_string: 's', new_string: 's' })).rejects.toThrow(/identical/)
    await expect(TOOLS.edit_file!.execute({ path: '/etc/hosts', old_string: 'a', new_string: 'b' })).rejects.toThrow(/outside the agent's home/)
  })
})

describe('git_worktree command builders', () => {
  const home = homedir()

  it('derives a clone dir + worktree path from a URL', () => {
    const r = wtInternal.resolveRepo('https://github.com/openape-ai/openape.git')
    expect(r.isUrl).toBe(true)
    expect(r.baseDir).toBe(`${home}/repos/openape-ai-openape`)
    expect(wtInternal.worktreePathFor('issue-42')).toBe(`${home}/work/issue-42`)
  })

  it('jails local repo paths under $HOME', () => {
    expect(() => wtInternal.resolveRepo('/etc')).toThrow(/outside the agent's home/)
    const r = wtInternal.resolveRepo('repos/myclone')
    expect(r.isUrl).toBe(false)
    expect(r.baseDir).toBe(`${home}/repos/myclone`)
  })

  it('validates task_id and branch charsets', () => {
    expect(() => wtInternal.assertTaskId('bad id!')).toThrow(/task_id must match/)
    expect(() => wtInternal.assertBranch('bad branch;rm')).toThrow(/branch must match/)
    expect(wtInternal.assertTaskId('issue-42')).toBe('issue-42')
    expect(wtInternal.assertBranch('feat/x-1')).toBe('feat/x-1')
  })

  it('builds a create command that clones-if-needed and adds the worktree', () => {
    const cmd = wtInternal.buildCreateCommand('https://github.com/openape-ai/openape.git', 'issue-42', 'fix/issue-42')
    expect(cmd).toContain('git clone')
    expect(cmd).toContain(`worktree add -b 'fix/issue-42' '${home}/work/issue-42'`)
  })

  it('builds remove + list commands', () => {
    expect(wtInternal.buildRemoveCommand('repos/myclone', 'issue-42')).toContain('worktree remove --force')
    expect(wtInternal.buildListCommand()).toContain(`${home}/work`)
  })

  it('rejects injection attempts in inputs', () => {
    expect(() => wtInternal.buildCreateCommand('https://github.com/x/y.git', 'a\'; rm -rf ~', 'b')).toThrow(/task_id must match/)
    expect(() => wtInternal.buildCreateCommand('https://github.com/x/y.git', 'ok', 'b\'; rm -rf ~')).toThrow(/branch must match/)
  })
})
