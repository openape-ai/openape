import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readLitellmEnv } from '../src/lib/llm-bridge'

describe('llm-bridge — pure helpers', () => {
  it('readLitellmEnv parses LITELLM_MASTER_KEY + LITELLM_BASE_URL, ignores comments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lbenv-'))
    try {
      const path = join(dir, '.env')
      writeFileSync(path, [
        '# comment',
        '',
        'LITELLM_MASTER_KEY=sk-litellm-AAAA',
        'LITELLM_BASE_URL=http://example:9999/v1',
        'OTHER=ignored',
      ].join('\n'))
      const got = readLitellmEnv(path)
      expect(got).toEqual({ apiKey: 'sk-litellm-AAAA', baseUrl: 'http://example:9999/v1' })
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('readLitellmEnv returns null when file missing', () => {
    expect(readLitellmEnv('/nonexistent/path/.env')).toBeNull()
  })

  it('readLitellmEnv accepts LITELLM_API_KEY as alias for LITELLM_MASTER_KEY', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lbenv-alias-'))
    try {
      const path = join(dir, '.env')
      writeFileSync(path, 'LITELLM_API_KEY=sk-litellm-BBB\n')
      expect(readLitellmEnv(path)).toEqual({ apiKey: 'sk-litellm-BBB' })
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
