import { podsUpdatePath } from '@openape/pods-protocol'
import { readRelease } from '../../utils/releases'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const release = await readRelease(String(useRuntimeConfig(event).podsReleaseDirectory))
  if (!release) throw createError({ statusCode: 503, statusMessage: 'The Mac download is not available yet' })
  return sendRedirect(event, `${podsUpdatePath}releases/${release.version}/${release.files.dmg.name}`, 302)
})
