import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { releaseMetadata } from '@openape/pods-protocol'
import { readRelease } from '../../../../utils/releases'

export default defineEventHandler(async (event) => {
  const directory = String(useRuntimeConfig(event).podsReleaseDirectory)
  const path = getRouterParam(event, 'path') ?? ''
  if (path === 'latest-mac.yml' || path === 'release.json') {
    setHeader(event, 'Cache-Control', 'no-store')
    const release = await readRelease(directory)
    if (!release) throw createError({ statusCode: 404, statusMessage: 'No published release' })
    if (path === 'release.json') return release
    setHeader(event, 'Content-Type', 'text/yaml; charset=utf-8')
    return releaseMetadata(release)
  }
  const match = /^releases\/(\d+\.\d+\.\d+)\/(OpenApe-Pods-[\d.]+-arm64-signed\.(dmg|zip))$/.exec(path)
  if (!directory || !match) throw createError({ statusCode: 404 })
  const release = await readRelease(directory, match[1])
  const artifact = release?.files[match[3] as 'dmg' | 'zip']
  if (!artifact || artifact.name !== match[2]) throw createError({ statusCode: 404 })
  const file = await open(join(resolve(directory), 'releases', release!.version, artifact.name), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size !== artifact.size) throw createError({ statusCode: 503, statusMessage: 'Release artifact unavailable' })
    setHeaders(event, { 'Cache-Control': 'public, max-age=31536000, immutable', 'ETag': `"${artifact.sha256}"`, 'Accept-Ranges': 'bytes', 'Content-Type': match[3] === 'zip' ? 'application/zip' : 'application/x-apple-diskimage', 'Content-Disposition': `attachment; filename="${artifact.name}"`, 'X-Content-Type-Options': 'nosniff' })
    let start = 0; let end = info.size - 1
    const range = getHeader(event, 'range')
    if (range && (!getHeader(event, 'if-range') || getHeader(event, 'if-range') === `"${artifact.sha256}"`)) {
      const bytes = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (bytes && (bytes[1] || bytes[2])) {
        start = bytes[1] ? Number(bytes[1]) : Math.max(0, info.size - Number(bytes[2]))
        end = bytes[1] && bytes[2] ? Math.min(Number(bytes[2]), end) : end
      }
      if (!bytes || !(bytes[1] || bytes[2]) || !Number.isSafeInteger(start) || start > end || start < 0 || end >= info.size) {
        setHeader(event, 'Content-Range', `bytes */${info.size}`)
        throw createError({ statusCode: 416 })
      }
      setResponseStatus(event, 206); setHeader(event, 'Content-Range', `bytes ${start}-${end}/${info.size}`)
    }
    setHeader(event, 'Content-Length', end - start + 1)
    return await sendStream(event, file.createReadStream({ start, end, autoClose: false }))
  }
  finally { await file.close() }
})
