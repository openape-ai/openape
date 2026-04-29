import { describe, expect, it } from 'vitest'
import { parseSecretsBlob } from '../src/secrets-store.js'

describe('parseSecretsBlob — happy path', () => {
  it('parses a valid two-entry TOML payload', () => {
    const toml = `
version = "1"

[secrets.gh_pat]
target   = "api.github.com/*"
header   = "Authorization"
template = "Bearer \${value}"
value    = "ghp_X"

[secrets.openai]
target   = "api.openai.com/*"
header   = "Authorization"
template = "Bearer \${value}"
value    = "sk-X"
`
    const store = parseSecretsBlob(toml)
    expect(store.entries.length).toBe(2)
    expect(store.entries[0]?.name).toBe('gh_pat')
    expect(store.entries[0]?.value).toBe('ghp_X')
    expect(store.entries[1]?.name).toBe('openai')
  })
})
