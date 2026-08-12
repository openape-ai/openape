import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// #1222 review: services_loop reads tools.txt unconditionally, with no
// legacy fallback. Without a valid org allowlist, parse.py must not leave
// a stale/foreign tools.txt behind in the reused scratch dir.
const PARSE_PY = join(import.meta.dirname, '../public/worker/parse.py')

function runParse(outdir: string, input: unknown): void {
  execFileSync('python3', [PARSE_PY, outdir], { input: JSON.stringify(input) })
}

function task(metadata?: Record<string, unknown>, tools?: string[]) {
  return { task: { id: 't-1', metadata, history: [{ parts: [{ data: { systemPrompt: '', userMessage: '', tools } }] }] } }
}

describe('parse.py — tools.txt allowlist enforcement (#1036/#1222)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'parse-py-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes tools.txt from the org allowlist when allowedTools is a list', () => {
    runParse(dir, task({ allowedTools: ['gh *'] }, ['rm *']))
    expect(readFileSync(join(dir, 'tools.txt'), 'utf8')).toBe('gh *')
  })

  it('removes tools.txt when allowedTools is missing (no silent fallback to task-declared tools)', () => {
    runParse(dir, task(undefined, ['rm *']))
    expect(existsSync(join(dir, 'tools.txt'))).toBe(false)
  })

  it('removes tools.txt when allowedTools is malformed (not a list)', () => {
    runParse(dir, task({ allowedTools: 'gh *' }, ['rm *']))
    expect(existsSync(join(dir, 'tools.txt'))).toBe(false)
  })

  it('does not leak a previous task\'s tools.txt into a reused scratch dir', () => {
    runParse(dir, task({ allowedTools: ['gh *'] }, []))
    expect(readFileSync(join(dir, 'tools.txt'), 'utf8')).toBe('gh *')
    // Same scratch dir, next task has no org allowlist.
    runParse(dir, task(undefined, ['rm *']))
    expect(existsSync(join(dir, 'tools.txt'))).toBe(false)
  })
})
