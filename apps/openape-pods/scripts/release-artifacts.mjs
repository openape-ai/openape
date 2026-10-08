import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parsePodsRelease } from '@openape/pods-protocol'

export async function releaseFile(path) {
  const sha256 = createHash('sha256'); const sha512 = createHash('sha512')
  for await (const bytes of createReadStream(path)) { sha256.update(bytes); sha512.update(bytes) }
  return { name: basename(path), size: (await stat(path)).size, sha256: sha256.digest('hex'), sha512: sha512.digest('base64') }
}
export async function writeReleaseArtifacts(output, artifacts, review) {
  const manifest = JSON.parse(await readFile('dist/distribution/pods-distribution.json', 'utf8'))
  if (!manifest.releaseReady) throw new Error('Only reviewed public releases can produce channel metadata')
  const dmg = artifacts.filter(path => path.endsWith('.dmg')); const zip = artifacts.filter(path => path.endsWith('.zip'))
  if (dmg.length !== 1 || zip.length !== 1) throw new Error('Expected one DMG and one update ZIP')
  const [dmgFile, zipFile] = await Promise.all([releaseFile(dmg[0]), releaseFile(zip[0])])
  const notes = process.env.OPENAPE_PODS_RELEASE_NOTES
  if (!notes?.trim()) throw new Error('Set OPENAPE_PODS_RELEASE_NOTES to the reviewed release summary')
  const release = parsePodsRelease({ ...manifest, format: 'openape-pods-release', minimumSystemVersion: '14.0', verifiedSystemVersion: '26.6.2', supportedKernel: '25.6.0', sourceRevision: review.sourceRevision, dependencyLockHash: review.dependencyLockHash, releasedAt: new Date().toISOString(), notes, files: { dmg: dmgFile, zip: zipFile } })
  await writeFile(join(output, 'release.json'), `${JSON.stringify(release, null, 2)}\n`)
}
