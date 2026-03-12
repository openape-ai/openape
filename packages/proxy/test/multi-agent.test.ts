import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { loadMultiAgentConfig } from '../src/config.js'

function tmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'proxy-test-'))
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

describe('loadMultiAgentConfig', () => {
  it('loads multi-agent TOML config', () => {
    const path = tmpFile('proxy.toml', `
[proxy]
listen = "127.0.0.1:9090"
default_action = "block"
mandatory_auth = true

[[agents]]
email = "bot1@example.com"
idp_url = "https://id1.example.com"

[[agents.allow]]
domain = "api.github.com"

[[agents]]
email = "bot2@example.com"
idp_url = "https://id2.example.com"
`)

    const config = loadMultiAgentConfig(path)

    expect(config.proxy.listen).toBe('127.0.0.1:9090')
    expect(config.proxy.default_action).toBe('block')
    expect(config.proxy.mandatory_auth).toBe(true)
    expect(config.agents).toHaveLength(2)
    expect(config.agents[0].email).toBe('bot1@example.com')
    expect(config.agents[0].idp_url).toBe('https://id1.example.com')
    expect(config.agents[0].allow).toHaveLength(1)
    expect(config.agents[0].allow![0].domain).toBe('api.github.com')
    expect(config.agents[1].email).toBe('bot2@example.com')
  })

  it('converts single-agent config to multi-agent format', () => {
    const path = tmpFile('legacy.toml', `
[proxy]
listen = "127.0.0.1:9090"
idp_url = "https://id.example.com"
agent_email = "agent@example.com"
default_action = "request-async"

[[allow]]
domain = "*.github.com"

[[deny]]
domain = "evil.com"

[[grant_required]]
domain = "api.openai.com"
grant_type = "once"
`)

    const config = loadMultiAgentConfig(path)

    expect(config.proxy.listen).toBe('127.0.0.1:9090')
    expect(config.proxy.default_action).toBe('request-async')
    expect(config.agents).toHaveLength(1)
    expect(config.agents[0].email).toBe('agent@example.com')
    expect(config.agents[0].idp_url).toBe('https://id.example.com')
    expect(config.agents[0].allow).toHaveLength(1)
    expect(config.agents[0].deny).toHaveLength(1)
    expect(config.agents[0].grant_required).toHaveLength(1)
  })

  it('applies mandatory-auth override', () => {
    const path = tmpFile('override.toml', `
[proxy]
listen = "127.0.0.1:9090"
idp_url = "https://id.example.com"
agent_email = "agent@example.com"
`)

    const config = loadMultiAgentConfig(path, { mandatoryAuth: true })
    expect(config.proxy.mandatory_auth).toBe(true)
  })

  it('loads multi-agent JSON config', () => {
    const path = tmpFile('proxy.json', JSON.stringify({
      proxy: {
        listen: '127.0.0.1:9090',
        default_action: 'block',
      },
      agents: [
        { email: 'a@b.com', idp_url: 'https://id.example.com' },
      ],
    }))

    const config = loadMultiAgentConfig(path)
    expect(config.agents).toHaveLength(1)
    expect(config.agents[0].email).toBe('a@b.com')
  })

  it('throws on missing listen', () => {
    const path = tmpFile('bad.toml', `
[proxy]
default_action = "block"
`)
    expect(() => loadMultiAgentConfig(path)).toThrow('listen')
  })

  it('throws on single-agent without idp_url', () => {
    const path = tmpFile('bad2.toml', `
[proxy]
listen = "127.0.0.1:9090"
agent_email = "agent@example.com"
`)
    expect(() => loadMultiAgentConfig(path)).toThrow('idp_url')
  })
})
