import type { H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The plugin resolves the client IP via h3's getRequestIP; route it
// through a per-event field so each test controls the source IP.
vi.mock('h3', async () => {
  const actual = await vi.importActual<any>('h3')
  return {
    ...actual,
    getRequestIP: (event: any) => event.__testIp,
  }
})

interface SimulatedResponse {
  status: number
  headers: Record<string, string>
}

// Minimal nitro harness: registers the plugin's 'request' hook and lets
// tests fire requests against it, capturing status + rate-limit headers.
async function createLimiter() {
  const { default: plugin } = await import('../src/runtime/server/plugins/rate-limit')
  let handler: (event: H3Event) => void
  const nitroApp = {
    hooks: {
      hook: (_name: string, fn: (event: H3Event) => void) => {
        handler = fn
      },
    },
  }
  plugin(nitroApp as any)
  return (path: string, ip = '198.51.100.10'): SimulatedResponse => {
    const headers: Record<string, string> = {}
    const res = {
      statusCode: 200,
      setHeader: (name: string, value: string) => {
        headers[name] = value
      },
      end: () => {},
    }
    const event = {
      path,
      __testIp: ip,
      node: { req: { headers: {} }, res },
    } as unknown as H3Event
    handler!(event)
    return { status: res.statusCode, headers }
  }
}

beforeEach(() => {
  // Fresh module state (the bucket store is module-level) and clean env.
  vi.resetModules()
  delete process.env.OPENAPE_E2E
  delete process.env.OPENAPE_RATE_LIMIT_MAX_AUTH
  delete process.env.OPENAPE_RATE_LIMIT_MAX_AGENT
  delete process.env.OPENAPE_RATE_LIMIT_MAX_MANAGEMENT
  delete process.env.OPENAPE_RATE_LIMIT_TRUSTED_PROXIES
})

describe('strict bucket (unauthenticated credential ceremonies)', () => {
  it('allows 10 login attempts per minute, rejects the 11th', async () => {
    const request = await createLimiter()
    for (let i = 0; i < 10; i++) {
      expect(request('/api/session/login').status).toBe(200)
    }
    const eleventh = request('/api/session/login')
    expect(eleventh.status).toBe(429)
    expect(Number(eleventh.headers['Retry-After'])).toBeGreaterThan(0)
  })

  it('shares one per-IP pot across all strict paths (/authorize drains with /api/session)', async () => {
    const request = await createLimiter()
    for (let i = 0; i < 10; i++) request('/api/session/login')
    // Same nature, same budget: an attacker cannot multiply attempts by
    // rotating between ceremony paths.
    expect(request('/authorize?client_id=x').status).toBe(429)
    expect(request('/api/webauthn/login/options').status).toBe(429)
  })

  it('reports the strict limit in X-RateLimit-Limit', async () => {
    const request = await createLimiter()
    expect(request('/api/session/login').headers['X-RateLimit-Limit']).toBe('10')
  })
})

describe('management bucket (authenticated owner APIs) — the #1073 core', () => {
  it('management load does not drain the login bucket', async () => {
    const request = await createLimiter()
    // A machine cleaning up 60 agents from the owner's IP…
    for (let i = 0; i < 60; i++) {
      expect(request('/api/my-agents/some-id').status).toBe(200)
    }
    // …must not push the owner's browser login into 429.
    expect(request('/api/session/login').status).toBe(200)
  })

  it('login brute-force does not consume the management budget (and vice versa caps at 60)', async () => {
    const request = await createLimiter()
    for (let i = 0; i < 11; i++) request('/api/session/login')
    // Strict bucket is exhausted; management keeps its own 60/min.
    for (let i = 0; i < 60; i++) {
      expect(request('/api/my-agents').status).toBe(200)
    }
    expect(request('/api/my-agents').status).toBe(429)
  })

  it('covers /api/users and reports its own limit header', async () => {
    const request = await createLimiter()
    const res = request('/api/users/foo@bar.com/whatever')
    expect(res.status).toBe(200)
    expect(res.headers['X-RateLimit-Limit']).toBe('60')
  })
})

describe('qr bucket (kiosk claim polling)', () => {
  it('two minutes of claim polling does not drain the login bucket', async () => {
    const request = await createLimiter()
    // A kiosk polling every 2s for the full channel TTL (~60 calls)…
    for (let i = 0; i < 60; i++) {
      expect(request(`/api/session/qr/${'a'.repeat(64)}/claim`).status).toBe(200)
    }
    // …must not push the same IP's passkey login into 429.
    expect(request('/api/session/login').status).toBe(200)
  })

  it('caps at its own limit and reports it', async () => {
    const request = await createLimiter()
    const first = request('/api/session/qr')
    expect(first.headers['X-RateLimit-Limit']).toBe('90')
    for (let i = 0; i < 89; i++) request('/api/session/qr')
    expect(request('/api/session/qr').status).toBe(429)
    // The strict bucket is untouched by the QR flood.
    expect(request('/api/session/login').status).toBe(200)
  })
})

describe('/token joins the agent bucket', () => {
  it('allows sustained token minting well beyond the strict cap', async () => {
    const request = await createLimiter()
    for (let i = 0; i < 30; i++) {
      expect(request('/token').status).toBe(200)
    }
    // And it did not touch the strict login budget.
    expect(request('/api/session/login').status).toBe(200)
  })

  it('shares the per-IP pot with /api/agent/* and reports the agent limit', async () => {
    const request = await createLimiter()
    expect(request('/token').headers['X-RateLimit-Limit']).toBe('120')
    for (let i = 0; i < 120; i++) request('/api/agent/challenge')
    expect(request('/token').status).toBe(429)
  })
})

describe('per-IP isolation', () => {
  it('one exhausted IP does not affect another', async () => {
    const request = await createLimiter()
    for (let i = 0; i < 11; i++) request('/api/session/login', '203.0.113.1')
    expect(request('/api/session/login', '203.0.113.1').status).toBe(429)
    expect(request('/api/session/login', '203.0.113.2').status).toBe(200)
  })
})

describe('env overrides per bucket', () => {
  it('OPENAPE_RATE_LIMIT_MAX_MANAGEMENT overrides the management cap', async () => {
    process.env.OPENAPE_RATE_LIMIT_MAX_MANAGEMENT = '3'
    const request = await createLimiter()
    for (let i = 0; i < 3; i++) {
      expect(request('/api/my-agents').status).toBe(200)
    }
    expect(request('/api/my-agents').status).toBe(429)
  })

  it('OPENAPE_RATE_LIMIT_MAX_AUTH still governs the strict bucket only', async () => {
    process.env.OPENAPE_RATE_LIMIT_MAX_AUTH = '2'
    const request = await createLimiter()
    request('/api/session/login')
    request('/api/session/login')
    expect(request('/api/session/login').status).toBe(429)
    // Management keeps its own default despite the tightened strict cap.
    expect(request('/api/my-agents').status).toBe(200)
    expect(request('/api/my-agents').headers['X-RateLimit-Limit']).toBe('60')
  })

  it('OPENAPE_RATE_LIMIT_MAX_AGENT governs /token too', async () => {
    process.env.OPENAPE_RATE_LIMIT_MAX_AGENT = '5'
    const request = await createLimiter()
    for (let i = 0; i < 5; i++) {
      expect(request('/token').status).toBe(200)
    }
    expect(request('/token').status).toBe(429)
  })

  it('invalid OPENAPE_RATE_LIMIT_MAX_MANAGEMENT falls back to 60', async () => {
    process.env.OPENAPE_RATE_LIMIT_MAX_MANAGEMENT = 'lots'
    const request = await createLimiter()
    expect(request('/api/my-agents').headers['X-RateLimit-Limit']).toBe('60')
  })
})
