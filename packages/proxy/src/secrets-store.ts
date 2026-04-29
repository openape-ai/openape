import { parse as parseTOML } from 'smol-toml'
import type { SecretEntry, SecretsStore } from './types.js'
import { matchSecret } from './secrets-match.js'

export function parseSecretsBlob(toml: string): SecretsStore {
  const parsed = parseTOML(toml) as Record<string, unknown>
  const secretsBlock = parsed.secrets as Record<string, Partial<SecretEntry>> | undefined
  const entries: SecretEntry[] = []
  if (secretsBlock) {
    for (const [name, raw] of Object.entries(secretsBlock)) {
      entries.push({
        name,
        target: raw.target ?? '',
        header: raw.header ?? '',
        template: raw.template ?? '',
        value: raw.value ?? '',
      })
    }
  }
  return {
    entries,
    findFor: target => matchSecret(target, entries),
  }
}
