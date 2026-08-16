import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'

// #1036: public/worker/parse.py derives the execution allowlist (tools.txt)
// from task.metadata.allowedTools. It must never fall back to the
// client-supplied data.tools when the org-scoped metadata is missing or
// malformed — that would let a client bypass server-side validation.
const parsePy = join(__dirname, '../public/worker/parse.py')

function runParse(taskPayload: unknown) {
  const outdir = mkdtempSync(join(tmpdir(), 'parse-py-test-'))
  execFileSync('python3', [parsePy, outdir], {
    input: JSON.stringify({ task: taskPayload }),
  })
  return {
    outdir,
    toolsTxt: existsSync(join(outdir, 'tools.txt')) ? readFileSync(join(outdir, 'tools.txt'), 'utf8') : null,
    allowedTxt: existsSync(join(outdir, 'allowed.txt')) ? readFileSync(join(outdir, 'allowed.txt'), 'utf8') : null,
  }
}

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function baseTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    history: [{ parts: [{ data: { systemPrompt: '', userMessage: '', tools: ['bash', 'browser'] } }] }],
    ...overrides,
  }
}

describe('worker/parse.py — #1036 tool allowlist', () => {
  it('writes tools.txt from metadata.allowedTools when present', () => {
    const { outdir, toolsTxt, allowedTxt } = runParse(baseTask({ metadata: { allowedTools: ['bash'] } }))
    dirs.push(outdir)
    expect(toolsTxt).toBe('bash')
    expect(allowedTxt).toBe('bash')
  })

  it('empty allowedTools list means a hard read-only sandbox, not the client tools', () => {
    const { outdir, toolsTxt } = runParse(baseTask({ metadata: { allowedTools: [] } }))
    dirs.push(outdir)
    expect(toolsTxt).toBe('')
  })

  it('never falls back to client-supplied data.tools when metadata.allowedTools is missing', () => {
    const { outdir, toolsTxt, allowedTxt } = runParse(baseTask({ metadata: {} }))
    dirs.push(outdir)
    expect(toolsTxt).toBeNull()
    expect(allowedTxt).toBeNull()
  })

  it('never falls back to client-supplied data.tools when allowedTools is malformed', () => {
    const { outdir, toolsTxt } = runParse(baseTask({ metadata: { allowedTools: 'bash' } }))
    dirs.push(outdir)
    expect(toolsTxt).toBeNull()
  })

  it('does not leak a stale tools.txt from a previous task in a reused scratch dir', () => {
    // Same outdir, first call has a valid allowlist, second call (reused dir,
    // e.g. a differently-configured org) has no metadata at all.
    const outdir = mkdtempSync(join(tmpdir(), 'parse-py-test-'))
    dirs.push(outdir)
    execFileSync('python3', [parsePy, outdir], {
      input: JSON.stringify({ task: baseTask({ metadata: { allowedTools: ['bash'] } }) }),
    })
    expect(readFileSync(join(outdir, 'tools.txt'), 'utf8')).toBe('bash')
    execFileSync('python3', [parsePy, outdir], {
      input: JSON.stringify({ task: baseTask({ metadata: {} }) }),
    })
    expect(existsSync(join(outdir, 'tools.txt'))).toBe(false)
    expect(existsSync(join(outdir, 'allowed.txt'))).toBe(false)
  })
})
