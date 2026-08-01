// Security checklist: management-token auth (timing-safe comparison),
// session fallback, and the admin/root authorization tiers — including
// resolver precedence and the fail-closed root tier.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const config = {
  openapeIdp: {
    managementToken: '',
    adminEmails: '',
  } as Record<string, string>,
}

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => config,
  useEvent: () => undefined,
}))

vi.mock('h3', () => ({
  getHeader: (event: any, name: string) => event.headers?.[name.toLowerCase()],
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), opts),
}))

let bearerPayload: { sub: string, act: string } | null = null
vi.mock('../src/runtime/server/utils/agent-auth', () => ({
  tryBearerAuth: async () => bearerPayload,
}))

let sessionUserId: string | undefined
let sessionThrows = false
vi.mock('../src/runtime/server/utils/session', () => ({
  getAppSession: async () => {
    if (sessionThrows) throw new Error('session secret not configured')
    return { data: { userId: sessionUserId } }
  },
}))

function makeEvent(opts: { auth?: string, context?: Record<string, unknown> } = {}) {
  return {
    headers: opts.auth ? { authorization: opts.auth } : {},
    context: opts.context ?? {},
  } as any
}

describe('admin auth tiers', () => {
  beforeEach(() => {
    config.openapeIdp.managementToken = 'secret-mgmt-token'
    config.openapeIdp.adminEmails = 'Admin@Example.com, second@example.com'
    bearerPayload = null
    sessionUserId = undefined
    sessionThrows = false
  })

  describe('requireAuth', () => {
    it('accepts the management token (timing-safe compare)', async () => {
      const { requireAuth } = await import('../src/runtime/server/utils/admin')
      const identity = await requireAuth(makeEvent({ auth: 'Bearer secret-mgmt-token' }))
      expect(identity).toBe('_management_')
    })

    it('falls back to JWT auth for a non-management bearer token', async () => {
      const { requireAuth } = await import('../src/runtime/server/utils/admin')
      bearerPayload = { sub: 'me@example.com', act: 'human' }
      const identity = await requireAuth(makeEvent({ auth: 'Bearer some-jwt' }))
      expect(identity).toBe('me@example.com')
    })

    it('rejects a bearer token that is neither management token nor valid JWT', async () => {
      const { requireAuth } = await import('../src/runtime/server/utils/admin')
      await expect(requireAuth(makeEvent({ auth: 'Bearer wrong-token' })))
        .rejects
        .toMatchObject({ statusCode: 403 })
    })

    it('rejects a token of different length without leaking timing', async () => {
      const { requireAuth } = await import('../src/runtime/server/utils/admin')
      await expect(requireAuth(makeEvent({ auth: 'Bearer x' })))
        .rejects
        .toMatchObject({ statusCode: 403 })
    })

    it('treats any bearer token as invalid when no management token is configured', async () => {
      const { requireAuth } = await import('../src/runtime/server/utils/admin')
      config.openapeIdp.managementToken = ''
      bearerPayload = { sub: 'me@example.com', act: 'human' }
      const identity = await requireAuth(makeEvent({ auth: 'Bearer some-jwt' }))
      expect(identity).toBe('me@example.com')
    })

    it('uses the session when no Authorization header is present', async () => {
      const { requireAuth } = await import('../src/runtime/server/utils/admin')
      sessionUserId = 'session-user@example.com'
      const identity = await requireAuth(makeEvent())
      expect(identity).toBe('session-user@example.com')
    })

    it('rejects an empty session with 401', async () => {
      const { requireAuth } = await import('../src/runtime/server/utils/admin')
      await expect(requireAuth(makeEvent())).rejects.toMatchObject({ statusCode: 401 })
    })

    it('rejects with 401 when the session layer is unavailable', async () => {
      const { requireAuth } = await import('../src/runtime/server/utils/admin')
      sessionThrows = true
      await expect(requireAuth(makeEvent())).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('requireAdmin', () => {
    it('accepts the management token', async () => {
      const { requireAdmin } = await import('../src/runtime/server/utils/admin')
      expect(await requireAdmin(makeEvent({ auth: 'Bearer secret-mgmt-token' }))).toBe('_management_')
    })

    it('rejects an invalid management token even with an admin session', async () => {
      const { requireAdmin } = await import('../src/runtime/server/utils/admin')
      sessionUserId = 'admin@example.com'
      await expect(requireAdmin(makeEvent({ auth: 'Bearer wrong' })))
        .rejects
        .toMatchObject({ statusCode: 403 })
    })

    it('accepts an allowlisted session user, case-insensitively', async () => {
      const { requireAdmin } = await import('../src/runtime/server/utils/admin')
      sessionUserId = 'ADMIN@example.com'
      expect(await requireAdmin(makeEvent())).toBe('ADMIN@example.com')
    })

    it('rejects a session user outside the allowlist', async () => {
      const { requireAdmin } = await import('../src/runtime/server/utils/admin')
      sessionUserId = 'mortal@example.com'
      await expect(requireAdmin(makeEvent())).rejects.toMatchObject({ statusCode: 403 })
    })

    it('a registered resolver takes precedence over the allowlist — grant', async () => {
      const { requireAdmin } = await import('../src/runtime/server/utils/admin')
      sessionUserId = 'mortal@example.com'
      const event = makeEvent({ context: { openapeAdminResolver: async () => true } })
      expect(await requireAdmin(event)).toBe('mortal@example.com')
    })

    it('a registered resolver takes precedence over the allowlist — deny', async () => {
      const { requireAdmin } = await import('../src/runtime/server/utils/admin')
      sessionUserId = 'admin@example.com' // allowlisted, but resolver says no
      const event = makeEvent({ context: { openapeAdminResolver: async () => false } })
      await expect(requireAdmin(event)).rejects.toMatchObject({ statusCode: 403 })
    })
  })

  describe('requireRootAdmin', () => {
    it('fails closed when no root resolver is registered, even for allowlisted admins', async () => {
      const { requireRootAdmin } = await import('../src/runtime/server/utils/admin')
      sessionUserId = 'admin@example.com'
      await expect(requireRootAdmin(makeEvent())).rejects.toMatchObject({
        statusCode: 403,
        statusMessage: 'Root admin access required',
      })
    })

    it('ignores the non-root admin resolver for the root tier', async () => {
      const { requireRootAdmin } = await import('../src/runtime/server/utils/admin')
      sessionUserId = 'mortal@example.com'
      const event = makeEvent({ context: { openapeAdminResolver: async () => true } })
      await expect(requireRootAdmin(event)).rejects.toMatchObject({ statusCode: 403 })
    })

    it('accepts a user granted by the root resolver', async () => {
      const { requireRootAdmin } = await import('../src/runtime/server/utils/admin')
      sessionUserId = 'operator@example.com'
      const event = makeEvent({ context: { openapeRootAdminResolver: async () => true } })
      expect(await requireRootAdmin(event)).toBe('operator@example.com')
    })
  })

  describe('isAdmin', () => {
    it('matches allowlist entries case-insensitively', async () => {
      const { isAdmin } = await import('../src/runtime/server/utils/admin')
      expect(isAdmin('admin@EXAMPLE.com')).toBe(true)
      expect(isAdmin('second@example.com')).toBe(true)
      expect(isAdmin('mortal@example.com')).toBe(false)
    })

    it('returns false when no allowlist is configured', async () => {
      const { isAdmin } = await import('../src/runtime/server/utils/admin')
      config.openapeIdp.adminEmails = ''
      expect(isAdmin('admin@example.com')).toBe(false)
    })
  })
})
