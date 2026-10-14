import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { adapterFileDigest, semanticAdapterDigest } from '../src/digest.js'
import { checkCliVersion, exactCommand, loadRegistryAdapter } from '../src/registry-adapter.js'
import { resolveCommand } from '../src/parser.js'
import { parseAdapterToml } from '../src/toml.js'
import type { RegistryIndex } from '../src/types.js'

const adapter = `schema = "openape-shapes/v1"
[cli]
id = "fixture"
executable = "fixture-cli"
tested_versions = ["2.1"]
version_command = ["--version"]
version_pattern = '^fixture (\\d+\\.\\d+)'
[[operation]]
id = "read"
command = ["read"]
positionals = ["item"]
display = "Read {item}"
action = "read"
risk = "low"
resource_chain = ["item:id={item}"]
`

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function installed(content = adapter): string {
  const directory = mkdtempSync(join(tmpdir(), 'shapes-registry-adapter-'))
  directories.push(directory)
  writeFileSync(join(directory, 'fixture.toml'), content)
  return directory
}

function index(overrides: Partial<RegistryIndex['adapters'][number]> = {}): RegistryIndex {
  return { version: 1, generated_at: '2026-10-14T00:00:00Z', adapters: [{ id: 'fixture', name: 'Fixture', description: '', category: 'other', tags: [], author: 'test', executable: 'fixture-cli', min_shapes_version: '0.1.0', digest: adapterFileDigest(adapter), grant_digest: semanticAdapterDigest(parseAdapterToml(adapter)), download_url: 'https://example.invalid/fixture.toml', ...overrides }] }
}

describe('loadRegistryAdapter', () => {
  it('loads the installed adapter whose bytes and semantics match the registry entry, by id or executable', () => {
    const directory = installed()
    for (const name of ['fixture', 'fixture-cli']) {
      const { entry, loaded } = loadRegistryAdapter(index(), name, directory)
      expect(entry.id).toBe('fixture')
      expect(loaded.source).toBe(join(directory, 'fixture.toml'))
      expect(loaded.fileDigest).toBe(entry.digest)
    }
  })

  it('refuses CLIs without a registry entry, adapters that are not installed and changed adapter files', () => {
    const directory = installed()
    expect(() => loadRegistryAdapter(index(), 'other-cli', directory)).toThrow(expect.objectContaining({ problem: 'not_in_registry', message: 'The shapes registry has no adapter for other-cli; only registry adapters are accepted' }))
    expect(() => loadRegistryAdapter(index(), 'fixture', join(directory, 'missing'))).toThrow(expect.objectContaining({ problem: 'not_installed', message: 'The registry adapter fixture is not installed; run apes adapter install fixture' }))
    writeFileSync(join(directory, 'fixture.toml'), adapter.replace('Read {item}', 'Read the item {item}'))
    expect(() => loadRegistryAdapter(index(), 'fixture', directory)).toThrow(expect.objectContaining({ problem: 'digest_mismatch' }))
  })

  it('refuses an index whose grant digest does not describe the adapter', () => {
    expect(() => loadRegistryAdapter(index({ grant_digest: 'SHA-256:0000' }), 'fixture', installed())).toThrow(expect.objectContaining({ problem: 'digest_mismatch' }))
  })
})

describe('checkCliVersion', () => {
  const parsed = parseAdapterToml(adapter)
  it('accepts only a tested version read by the version pattern', () => {
    expect(checkCliVersion(parsed, 'fixture 2.1.4\n')).toEqual({ version: '2.1', tested: true })
    expect(checkCliVersion(parsed, 'fixture 2.2.0\n')).toEqual({ version: '2.2', tested: false })
    expect(checkCliVersion(parsed, 'something else')).toEqual({ version: null, tested: false })
    expect(checkCliVersion(parsed, null)).toEqual({ version: null, tested: false })
  })

  it('never treats an adapter without version data as tested', () => {
    const { tested_versions: _tested, version_command: _command, version_pattern: _pattern, ...cli } = parsed.cli
    expect(checkCliVersion({ ...parsed, cli }, 'fixture 2.1')).toEqual({ version: null, tested: false })
  })
})

it('binds a resolved command to its exact argv without changing its permission', async () => {
  const loaded = { adapter: parseAdapterToml(adapter), source: 'fixture.toml', digest: 'SHA-256:fixture' }
  const resolved = await resolveCommand(loaded, ['fixture-cli', 'read', 'a'])
  const exact = exactCommand(resolved)
  expect(exact.detail.constraints).toEqual({ exact_command: true })
  expect(exact.permission).toBe(resolved.permission)
  expect(resolved.detail.constraints).toBeUndefined()
})
