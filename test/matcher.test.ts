import { describe, expect, it } from 'vitest'
import { evaluateRules } from '../src/matcher.js'
import type { ProxyConfig } from '../src/types.js'

const baseConfig: ProxyConfig = {
  proxy: {
    listen: '127.0.0.1:9090',
    idp_url: 'https://id.example.com',
    agent_email: 'agent@example.com',
    default_action: 'block',
  },
  allow: [],
  deny: [],
  grant_required: [],
}

describe('evaluateRules', () => {
  it('prefers deny over allow', () => {
    const action = evaluateRules(
      {
        ...baseConfig,
        deny: [{ domain: 'api.example.com' }],
        allow: [{ domain: 'api.example.com' }],
      },
      'api.example.com',
      'GET',
      '/v1',
    )

    expect(action.type).toBe('deny')
  })

  it('returns grant_required when matching grant rule', () => {
    const action = evaluateRules(
      {
        ...baseConfig,
        grant_required: [{ domain: 'api.example.com', grant_type: 'once' }],
      },
      'api.example.com',
      'POST',
      '/v1',
    )

    expect(action.type).toBe('grant_required')
  })
})
