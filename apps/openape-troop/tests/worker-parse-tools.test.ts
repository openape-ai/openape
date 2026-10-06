import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const parsePy = join(__dirname, '../public/worker/parse.py')

let outdir: string
afterEach(() => {
  if (outdir) rmSync(outdir, { recursive: true, force: true })
})

function runParse(task: unknown): void {
  outdir = mkdtempSync(join(tmpdir(), 'parse-py-'))
  const res = spawnSync('python3', [parsePy, outdir], { input: JSON.stringify({ task }) })
  expect(res.status).toBe(0)
}

function baseTask(data: Record<string, unknown> = {}): unknown {
  return {
    id: 't-1',
    history: [{ parts: [{ data: { systemPrompt: '', userMessage: '', ...data } }] }],
  }
}

// #1036: metadata.allowedTools is the server-derived allowlist; the worker's
// execution backend reads tools.txt as the ground truth for what may run.
describe('worker/parse.py — tools.txt derivation (#1036)', () => {
  it('metadata.allowedTools wins over client-supplied data.tools', () => {
    runParse({ ...baseTask({ tools: ['rm *'] }), metadata: { allowedTools: ['o365-cli *', 'gh *'] } })
    expect(readFileSync(join(outdir, 'tools.txt'), 'utf8')).toBe('o365-cli *\ngh *')
    expect(readFileSync(join(outdir, 'allowed.txt'), 'utf8')).toBe('o365-cli *\ngh *')
  })

  it('an empty allowlist is a hard sandbox — tools.txt is empty, not absent', () => {
    runParse({ ...baseTask({ tools: ['rm *'] }), metadata: { allowedTools: [] } })
    expect(readFileSync(join(outdir, 'tools.txt'), 'utf8')).toBe('')
    expect(readFileSync(join(outdir, 'allowed.txt'), 'utf8')).toBe('')
  })

  it('missing metadata.allowedTools removes tools.txt instead of leaking client-supplied data.tools', () => {
    runParse({ ...baseTask({ tools: ['rm *', 'curl *'] }) })
    expect(existsSync(join(outdir, 'tools.txt'))).toBe(false)
    expect(existsSync(join(outdir, 'allowed.txt'))).toBe(false)
  })

  it('non-list metadata.allowedTools is treated like missing (removed, not passed through)', () => {
    runParse({ ...baseTask({ tools: ['rm *'] }), metadata: { allowedTools: 'o365-cli *' } })
    expect(existsSync(join(outdir, 'tools.txt'))).toBe(false)
  })

  it('a reused outdir does not leak a previous run\'s tools.txt into a legacy-path run', () => {
    outdir = mkdtempSync(join(tmpdir(), 'parse-py-'))
    writeFileSync(join(outdir, 'tools.txt'), 'o365-cli *\ngh *')
    writeFileSync(join(outdir, 'allowed.txt'), 'o365-cli *\ngh *')
    const res = spawnSync('python3', [parsePy, outdir], { input: JSON.stringify({ task: baseTask({ tools: ['rm *'] }) }) })
    expect(res.status).toBe(0)
    expect(existsSync(join(outdir, 'tools.txt'))).toBe(false)
    expect(existsSync(join(outdir, 'allowed.txt'))).toBe(false)
  })
})
