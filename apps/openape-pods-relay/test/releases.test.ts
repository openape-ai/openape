import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as h3 from 'h3'
import { afterEach, expect, it, vi } from 'vitest'
import { parsePodsRelease, releaseMetadata } from '@openape/pods-protocol'
import { readRelease } from '../server/utils/releases'
import type { PodsRelease } from '@openape/pods-protocol'

const roots: string[] = []
afterEach(async () => { vi.unstubAllGlobals(); for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pods-release-')); roots.push(root)
  const bytes = Buffer.from('signed-artifact-fixture')
  const artifact = (extension: string) => ({ name: `OpenApe-Pods-0.2.0-arm64-signed.${extension}`, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), sha512: createHash('sha512').update(bytes).digest('base64') })
  const release: PodsRelease = { format: 'openape-pods-release', version: '0.2.0', platform: 'darwin', architecture: 'arm64', minimumSystemVersion: '14.0', verifiedSystemVersion: '26.6.2', supportedKernel: '25.6.0', releaseReady: true, schema: { minimum: 1, current: 41 }, sourceRevision: 'a'.repeat(40), dependencyLockHash: 'b'.repeat(64), releasedAt: '2026-10-08T12:00:00Z', notes: 'Fixture update', files: { dmg: artifact('dmg'), zip: artifact('zip') } }
  const version = join(root, 'releases', release.version); await mkdir(version, { recursive: true })
  await writeFile(join(root, 'stable.json'), JSON.stringify(release)); await writeFile(join(version, 'release.json'), JSON.stringify(release))
  for (const file of Object.values(release.files)) await writeFile(join(version, file.name), bytes)
  return { root, release, bytes, version }
}
it('fails closed on internal builds, traversal and malformed or symlinked metadata', async () => {
  const { root, release } = await fixture()
  expect(await readRelease(root)).toEqual(release)
  expect(await readRelease('')).toBeNull()
  expect(() => parsePodsRelease({ ...release, releaseReady: false })).toThrow()
  expect(() => parsePodsRelease({ ...release, files: { ...release.files, zip: { ...release.files.zip, name: '../escape.zip' } } })).toThrow()
  await expect(readRelease(root, '../escape')).rejects.toThrow()
  await rm(join(root, 'stable.json')); await symlink(join(root, 'releases', release.version, 'release.json'), join(root, 'stable.json'))
  await expect(readRelease(root)).rejects.toThrow()
})
it('serves only published artifacts with resumable ranges and immutable caching', async () => {
  const { root, release, bytes } = await fixture()
  for (const [name, value] of Object.entries(h3)) vi.stubGlobal(name, value)
  vi.stubGlobal('useRuntimeConfig', () => ({ podsReleaseDirectory: root }))
  const { default: handler } = await import('../server/routes/updates/stable/darwin-arm64/[...path].get')
  const app = h3.createApp().use(h3.defineEventHandler(async (event) => { event.context.params = { path: h3.getRequestURL(event).pathname.slice(1) }; return handler(event) }))
  const server = createServer(h3.toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test server')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const meta = await fetch(`${origin}/latest-mac.yml`); expect(await meta.text()).toBe(releaseMetadata(release))
    const url = `${origin}/releases/${release.version}/${release.files.zip.name}`
    const part = await fetch(url, { headers: { range: 'bytes=2-6' } })
    expect(part.status).toBe(206); expect(part.headers.get('content-range')).toBe(`bytes 2-6/${bytes.length}`); expect(await part.text()).toBe(bytes.subarray(2, 7).toString())
    expect(part.headers.get('cache-control')).toContain('immutable')
    const invalid = await fetch(url, { headers: { range: 'bytes=999-1000' } }); expect(invalid.status).toBe(416)
    const missing = await fetch(`${origin}/releases/0.1.0/${release.files.zip.name}`); expect(missing.status).toBe(404)
    const metadata = await fetch(`${origin}/release.json`); expect(await metadata.json()).toEqual(release)
    expect(await readFile(join(root, 'stable.json'), 'utf8')).toBe(JSON.stringify(release))
  }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})
