import packageJson from '../../package.json'

export interface ChangelogPayload {
  service: 'openape-troop'
  version: string
  changelog: string
}

export function buildChangelogPayload(changelogText: string): ChangelogPayload {
  return {
    service: 'openape-troop',
    version: packageJson.version,
    changelog: changelogText,
  }
}
