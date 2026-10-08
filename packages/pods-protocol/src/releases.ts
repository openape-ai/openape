export const podsReleaseOrigin = 'https://pods.openape.ai'
export const podsUpdatePath = '/updates/stable/darwin-arm64/'
export interface ReleaseFile { name: string, size: number, sha256: string, sha512: string }
export interface PodsRelease {
  format: 'openape-pods-release'
  version: string
  platform: 'darwin'
  architecture: 'arm64'
  minimumSystemVersion: '14.0'
  verifiedSystemVersion: '26.6.2'
  supportedKernel: '25.6.0'
  releaseReady: true
  schema: { minimum: number, current: number }
  sourceRevision: string
  dependencyLockHash: string
  releasedAt: string
  notes: string
  files: { dmg: ReleaseFile, zip: ReleaseFile }
}
export function parsePodsRelease(value: unknown): PodsRelease {
  if (!value || typeof value !== 'object') throw new Error('Invalid Pods release')
  const release = value as PodsRelease
  if (release.format !== 'openape-pods-release' || !/^\d+\.\d+\.\d+$/.test(release.version) || release.version.split('.').some(part => !Number.isSafeInteger(Number(part))) || release.platform !== 'darwin' || release.architecture !== 'arm64' || release.minimumSystemVersion !== '14.0' || release.verifiedSystemVersion !== '26.6.2' || release.supportedKernel !== '25.6.0' || release.releaseReady !== true) throw new Error('Unsupported Pods release')
  if (!/^[a-f0-9]{40}$/.test(release.sourceRevision) || !/^[a-f0-9]{64}$/.test(release.dependencyLockHash) || typeof release.releasedAt !== 'string' || !Number.isFinite(Date.parse(release.releasedAt)) || typeof release.notes !== 'string' || release.notes.length > 20000) throw new Error('Invalid release provenance')
  if (!release.schema || ![release.schema.minimum, release.schema.current].every(value => Number.isSafeInteger(value) && value >= 1) || release.schema.minimum > release.schema.current) throw new Error('Invalid release schema')
  for (const extension of ['dmg', 'zip'] as const) {
    const file = release.files?.[extension]
    if (!file || file.name !== `OpenApe-Pods-${release.version}-arm64-signed.${extension}` || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 4 * 1024 ** 3 || !/^[a-f0-9]{64}$/.test(file.sha256) || !/^[A-Z0-9+/]{86}==$/i.test(file.sha512)) throw new Error('Invalid release artifact')
  }
  return release
}
export function releaseMetadata(release: PodsRelease): string {
  const file = release.files.zip
  const path = `releases/${release.version}/${file.name}`
  return `version: ${release.version}\nfiles:\n  - url: ${path}\n    sha512: ${file.sha512}\n    size: ${file.size}\npath: ${path}\nsha512: ${file.sha512}\nreleaseDate: ${JSON.stringify(release.releasedAt)}\nreleaseNotes: ${JSON.stringify(release.notes)}\n`
}
