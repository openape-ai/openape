import { readRelease } from '../../utils/releases'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const release = await readRelease(String(useRuntimeConfig(event).podsReleaseDirectory))
  return release ? { available: true, version: release.version, minimumSystemVersion: release.minimumSystemVersion, verifiedSystemVersion: release.verifiedSystemVersion, supportedKernel: release.supportedKernel, architecture: release.architecture, downloadUrl: '/download/mac' } : { available: false }
})
