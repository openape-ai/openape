import { mkdtempSync, rmSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureDirectory } from '../src/main/fixture'

const temporary: string[] = []
function directory() { const path = mkdtempSync(join(tmpdir(), 'pods-config-test-')); temporary.push(path); return path }
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }) })
describe('fixture data isolation', () => {
  it('reopens only its own explicit fixture directory', () => { const root = directory(); expect(fixtureDirectory(root)).toBe(root); expect(fixtureDirectory(root)).toBe(root) })
  it('rejects relative, shared, symlink and conflicting-marker locations', () => {
    expect(() => fixtureDirectory('relative')).toThrow('absolute')
    const root = directory(); const shared = join(root, 'shared'); mkdirSync(shared, { mode: 0o755 })
    expect(() => fixtureDirectory(shared)).toThrow('private')
    const link = join(root, 'link'); symlinkSync(root, link)
    expect(() => fixtureDirectory(link)).toThrow('private')
    writeFileSync(join(root, 'pods-fixture.json'), '{"fixture":false}')
    expect(() => fixtureDirectory(root)).toThrow('Not a Pods fixture')
  })
})
