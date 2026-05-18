import { parse as parseTOML } from 'smol-toml'
import type { SecretEntry, SecretsStore } from './types.js'
import { matchSecret } from './secrets-match.js'

const MAX_BLOB_BYTES = 4 * 1024
const SUPPORTED_VERSION = '1'

export function parseSecretsBlob(toml: string): SecretsStore {
  if (Buffer.byteLength(toml, 'utf-8') > MAX_BLOB_BYTES) {
    throw new Error(`Secrets blob too large (max ${MAX_BLOB_BYTES} bytes / 4 KiB)`)
  }

  const parsed = parseTOML(toml) as Record<string, unknown>
  const version = parsed.version
  if (version !== SUPPORTED_VERSION) {
    throw new Error(`Unsupported or missing version (expected "${SUPPORTED_VERSION}", got ${JSON.stringify(version)})`)
  }

  const secretsBlock = parsed.secrets as Record<string, Partial<SecretEntry>> | undefined
  const entries: SecretEntry[] = []
  if (secretsBlock) {
    for (const [name, raw] of Object.entries(secretsBlock)) {
      const required: (keyof SecretEntry)[] = ['target', 'header', 'template', 'value']
      for (const field of required) {
        if (!raw[field] || typeof raw[field] !== 'string') {
          throw new Error(`Secret '${name}' is missing required field '${field}'`)
        }
      }
      entries.push({
        name,
        target: raw.target!,
        header: raw.header!,
        template: raw.template!,
        value: raw.value!,
      })
    }
  }

  // Reject duplicate-specificity targets.
  const literalPrefix = (glob: string): string => {
    const i = glob.indexOf('*')
    return i < 0 ? glob : glob.slice(0, i)
  }
  const seen = new Map<string, string>()
  for (const e of entries) {
    const key = `${literalPrefix(e.target)}|${e.target}`
    if (seen.has(key)) {
      throw new Error(`Duplicate target with identical specificity: '${e.target}' (entries '${seen.get(key)}' and '${e.name}')`)
    }
    seen.set(key, e.name)
  }

  return {
    entries,
    findFor: target => matchSecret(target, entries),
  }
}
