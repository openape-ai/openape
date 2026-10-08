import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { parsePodsRelease } from '@openape/pods-protocol'
import { releaseFile } from './release-artifacts.mjs'

export async function publishRelease(source, destination) {
  const release = parsePodsRelease(JSON.parse(await readFile(join(source, 'release.json'), 'utf8')))
  await mkdir(destination, { recursive: true })
  const lock = join(destination, '.publishing')
  await mkdir(lock)
  const stage = join(destination, `.release-${randomUUID()}`)
  try {
    const versions = join(destination, 'releases'); await mkdir(versions, { recursive: true })
    const target = join(versions, release.version)
    let current
    try { current = parsePodsRelease(JSON.parse(await readFile(join(destination, 'stable.json'), 'utf8'))) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    if (current) {
      const previous = current.version.split('.').map(Number); const next = release.version.split('.').map(Number)
      const index = next.findIndex((part, i) => part !== previous[i])
      if (index >= 0 && next[index] < previous[index]) throw new Error('Publish a newer version; never downgrade the channel')
      if (index < 0 && !isDeepStrictEqual(current, release)) throw new Error('Release version already exists; never overwrite artifacts')
    }
    await mkdir(stage)
    for (const artifact of Object.values(release.files)) {
      const input = join(source, artifact.name)
      if (!(await lstat(input)).isFile()) throw new Error('Release artifact must be a regular file')
      await copyFile(input, join(stage, artifact.name), constants.COPYFILE_EXCL)
      const actual = await releaseFile(join(stage, artifact.name))
      if (actual.size !== artifact.size || actual.sha256 !== artifact.sha256 || actual.sha512 !== artifact.sha512) throw new Error('Release checksum mismatch')
    }
    const metadata = `${JSON.stringify(release, null, 2)}\n`
    await writeFile(join(stage, 'release.json'), metadata, { flag: 'wx' })
    let existing
    try { existing = parsePodsRelease(JSON.parse(await readFile(join(target, 'release.json'), 'utf8'))) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    if (existing) {
      if (!isDeepStrictEqual(existing, release)) throw new Error('Release version already exists; never overwrite artifacts')
      for (const artifact of Object.values(release.files)) {
        const actual = await releaseFile(join(target, artifact.name))
        if (!isDeepStrictEqual(actual, artifact)) throw new Error('Published release checksum mismatch')
      }
    }
    else {
      try { await lstat(target); throw new Error('Incomplete release directory requires inspection') }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      await rename(stage, target)
    }
    const pointer = join(lock, 'stable.json')
    await writeFile(pointer, metadata, { flag: 'wx' })
    await rename(pointer, join(destination, 'stable.json'))
    return { version: release.version, destination, sourceRevision: release.sourceRevision }
  }
  finally { await rm(stage, { recursive: true, force: true }); await rm(lock, { recursive: true, force: true }) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) throw new Error('Usage: node scripts/publish-release.mjs SOURCE_DIRECTORY RELEASE_DIRECTORY')
  console.log(JSON.stringify(await publishRelease(resolve(process.argv[2]), resolve(process.argv[3]))))
}
