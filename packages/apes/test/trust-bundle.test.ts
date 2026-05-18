import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildTrustBundle } from '../src/proxy/trust-bundle'

describe('detectSystemCaPath', () => {
  it('returns a path that exists on macOS or Linux', async () => {
    const { detectSystemCaPath } = await import('../src/proxy/trust-bundle')
    const path = detectSystemCaPath()
    expect(typeof path).toBe('string')
    expect(path.length).toBeGreaterThan(0)
  })
})

describe('buildTrustBundle', () => {
  it('concatenates system bundle + local CA into a temp file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sysca-'))
    const sysPath = join(dir, 'sys.pem')
    const localPath = join(dir, 'local.pem')
    writeFileSync(sysPath, 'SYSTEM_BUNDLE_CONTENTS\n')
    writeFileSync(localPath, 'LOCAL_CA_CONTENTS\n')

    const bundle = buildTrustBundle({ systemCaPath: sysPath, localCaPath: localPath })
    expect(existsSync(bundle.path)).toBe(true)
    const contents = readFileSync(bundle.path, 'utf-8')
    expect(contents).toContain('SYSTEM_BUNDLE_CONTENTS')
    expect(contents).toContain('LOCAL_CA_CONTENTS')

    bundle.cleanup()
    expect(existsSync(bundle.path)).toBe(false)
  })
})
