import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const parser = resolve(process.cwd(), 'public/worker/parse.py')

function parseTask(data: Record<string, unknown>, existingFiles: string[] = [], metadata?: Record<string, unknown>): { dir: string, output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'openape-parse-'))
  for (const name of existingFiles) writeFileSync(join(dir, name), 'stale')
  const task: Record<string, unknown> = { id: 'task-parse-test', history: [{ parts: [{ data }] }] }
  if (metadata) task.metadata = metadata
  const output = execFileSync('python3', [parser, dir], { input: JSON.stringify({ task }), encoding: 'utf8' })
  return { dir, output }
}

describe('worker parse.py allowlist boundary', () => {
  it('removes client-provided tools.txt when metadata is missing', () => {
    const { dir, output } = parseTask({ tools: ['curl *'] }, ['tools.txt', 'allowed.txt'])
    try {
      expect(output).toBe('task-parse-test\n')
      expect(() => readFileSync(join(dir, 'tools.txt'))).toThrow()
      expect(() => readFileSync(join(dir, 'allowed.txt'))).toThrow()
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('removes stale tools.txt for a malformed allowlist payload', () => {
    const { dir } = parseTask({ tools: ['curl *'] }, ['tools.txt'], { allowedTools: 'curl *' })
    try {
      expect(() => readFileSync(join(dir, 'tools.txt'))).toThrow()
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes only the server-derived allowlist to both worker files', () => {
    const { dir } = parseTask({ tools: ['rm *'] }, [], { allowedTools: ['curl *', 42] })
    try {
      expect(readFileSync(join(dir, 'allowed.txt'), 'utf8')).toBe('curl *')
      expect(readFileSync(join(dir, 'tools.txt'), 'utf8')).toBe('curl *')
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
