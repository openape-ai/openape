// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { publishRelease } from '../../scripts/publish-release.mjs'

const roots: string[] = []
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }) })
it('publishes both verified artifacts before the channel pointer and refuses corruption and internal releases', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pods-publish-')); roots.push(root)
  const source = join(root, 'input'); const destination = join(root, 'output'); await mkdir(source)
  const bytes = Buffer.from('Synthetic release fixture')
  const files = Object.fromEntries(['zip', 'dmg'].map(extension => [extension, { name: `OpenApe-Pods-0.2.0-arm64-signed.${extension}`, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), sha512: createHash('sha512').update(bytes).digest('base64') }]))
  const release = { format: 'openape-pods-release', version: '0.2.0', platform: 'darwin', architecture: 'arm64', minimumSystemVersion: '14.0', verifiedSystemVersion: '26.6.2', supportedKernel: '25.6.0', releaseReady: true, schema: { minimum: 1, current: 41 }, sourceRevision: 'a'.repeat(40), dependencyLockHash: 'b'.repeat(64), releasedAt: '2026-10-08T12:00:00Z', notes: 'Fixture', files }
  for (const file of Object.values(files)) await writeFile(join(source, file.name), bytes)
  await writeFile(join(source, 'release.json'), JSON.stringify({ ...release, releaseReady: false }))
  await expect(publishRelease(source, destination)).rejects.toThrow('Unsupported')
  await writeFile(join(source, 'release.json'), JSON.stringify(release))
  await writeFile(join(source, files.zip.name), 'corrupt')
  await expect(publishRelease(source, destination)).rejects.toThrow('checksum')
  await expect(readFile(join(destination, 'stable.json'))).rejects.toThrow()
  await writeFile(join(source, files.zip.name), bytes)
  await publishRelease(source, destination)
  expect(JSON.parse(await readFile(join(destination, 'stable.json'), 'utf8'))).toEqual(release)
  for (const file of Object.values(files)) expect(await readFile(join(destination, 'releases/0.2.0', file.name))).toEqual(bytes)
  await expect(publishRelease(source, destination)).resolves.toMatchObject({ version: '0.2.0' })
  await rm(join(destination, 'stable.json'))
  await expect(publishRelease(source, destination)).resolves.toMatchObject({ version: '0.2.0' })
  expect(JSON.parse(await readFile(join(destination, 'stable.json'), 'utf8'))).toEqual(release)
  await writeFile(join(source, 'release.json'), JSON.stringify({ ...release, notes: 'Replacement metadata' }))
  await expect(publishRelease(source, destination)).rejects.toThrow('never overwrite')
})
