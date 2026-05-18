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

describe('parseSecretsBlob — schema validation', () => {
  it('refuses missing version', () => {
    const toml = `[secrets.x]
target = "*"
header = "A"
template = "\${value}"
value = "v"`
    expect(() => parseSecretsBlob(toml)).toThrow(/version/i)
  })

  it('refuses unknown version', () => {
    const toml = `version = "9"
[secrets.x]
target = "*"
header = "A"
template = "\${value}"
value = "v"`
    expect(() => parseSecretsBlob(toml)).toThrow(/version/i)
  })

  it('refuses entry missing target', () => {
    const toml = `version = "1"
[secrets.x]
header = "A"
template = "\${value}"
value = "v"`
    expect(() => parseSecretsBlob(toml)).toThrow(/target/i)
  })

  it('refuses entry missing header', () => {
    const toml = `version = "1"
[secrets.x]
target = "*"
template = "\${value}"
value = "v"`
    expect(() => parseSecretsBlob(toml)).toThrow(/header/i)
  })

  it('refuses entry missing template', () => {
    const toml = `version = "1"
[secrets.x]
target = "*"
header = "A"
value = "v"`
    expect(() => parseSecretsBlob(toml)).toThrow(/template/i)
  })

  it('refuses entry missing value', () => {
    const toml = `version = "1"
[secrets.x]
target = "*"
header = "A"
template = "\${value}"`
    expect(() => parseSecretsBlob(toml)).toThrow(/value/i)
  })

  it('refuses oversized blob (> 4 KiB)', () => {
    const big = 'x'.repeat(4 * 1024 + 1)
    expect(() => parseSecretsBlob(big)).toThrow(/size|too large|4 KiB/i)
  })

  it('refuses duplicate target patterns with identical specificity', () => {
    const toml = `version = "1"
[secrets.a]
target = "api.github.com/*"
header = "A"
template = "\${value}"
value = "v1"
[secrets.b]
target = "api.github.com/*"
header = "B"
template = "\${value}"
value = "v2"`
    expect(() => parseSecretsBlob(toml)).toThrow(/duplicate/i)
  })
})
