import { describe, expect, it } from 'vitest'
import { asOpenAiTools, taskTools, TOOLS } from '../src/lib/agent-tools'
import { _internal as fileInternal } from '../src/lib/agent-tools/file'
import { homedir } from 'node:os'

describe('tool registry', () => {
  it('TOOLS has the expected keys', () => {
    for (const name of ['time.now', 'http.get', 'http.post', 'file.read', 'file.write', 'tasks.list', 'tasks.create', 'mail.list', 'mail.search', 'bash']) {
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
