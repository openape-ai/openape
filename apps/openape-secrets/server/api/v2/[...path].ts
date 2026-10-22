import { createHash } from 'node:crypto'
import { createClient } from '@libsql/client'
import { createError, defineEventHandler, getHeader, getMethod, getRouterParam, readBody, setHeader } from 'h3'
import { VaultStore } from '../../vault/store'
import { VaultError, VaultService } from '../../vault/service'

let service: Promise<VaultService> | undefined
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  if (![true, 'true', '1'].includes(config.secretsVaultEnabled as boolean)) throw createError({ statusCode: 404 })
  const origin = new URL(config.secretsVaultOrigin)
  if (origin.protocol !== 'https:' && !(import.meta.dev && origin.hostname === 'localhost')) throw createError({ statusCode: 503, statusMessage: 'Vault origin must use HTTPS' })
  if (!import.meta.dev && String(config.openapeSp.sessionSecret).startsWith('dev-')) throw createError({ statusCode: 503, statusMessage: 'Configure session secret before enabling vault' })
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Pragma', 'no-cache')
  const method = getMethod(event)
  const path = (getRouterParam(event, 'path') || '').split('/').filter(Boolean)
  const agentRoute = path[0] === 'requests' || (path[0] === 'approvals' && path[2] === 'collect')
  const principal = await requireScopedPrincipal(event, agentRoute ? ['secrets:request'] : [])
  // Cookie-authenticated writes always require the exact configured origin.
  if (method !== 'GET' && principal.authentication === 'session' && getHeader(event, 'origin') !== origin.origin) throw createError({ statusCode: 403, statusMessage: 'Origin mismatch' })
  const session = principal.authentication === 'session' ? await getSpSession(event) : undefined
  const p = { ...principal, session: session?.id ? createHash('sha256').update(session.id).digest('hex') : '' }
  if (!service) {
    service = (async () => {
      const store = new VaultStore(createClient({ url: config.tursoUrl, authToken: config.tursoAuthToken || undefined }))
      await store.initialize()
      return new VaultService(store, { rpName: 'OpenApe Secrets', rpID: origin.hostname, origin: origin.origin, requireUserVerification: true, residentKey: 'required', attestationType: 'none' })
    })().catch((e) => { service = undefined; throw e })
  }
  const vault = await service
  const length = Number(getHeader(event, 'content-length') || 0)
  if (length > 100000) throw createError({ statusCode: 413 })
  const body = method === 'POST' ? await readBody(event) : {}
  if (!body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > 100000) throw createError({ statusCode: 400, statusMessage: 'Invalid request body' })
  try {
    if (!agentRoute) vault.human(p)
    const route = `${method} ${path.join('/')}`
    if (route === 'GET vault') return await vault.view(p)
    if (route === 'POST setup/options') return await vault.setupOptions(p)
    if (route === 'POST setup/register') return await vault.register(p, body, 'setup')
    if (route === 'POST setup/confirm') return await vault.confirm(p, body, 'setup-confirm')
    if (route === 'POST credentials/register') return await vault.register(p, body, 'enroll')
    if (route === 'POST credentials/confirm') return await vault.confirm(p, body, 'enroll-confirm')
    if (route === 'POST actions/options') return await vault.actionOptions(p, body)
    if (route === 'POST actions/commit') return await vault.actionCommit(p, body)
    if (route === 'POST recovery/options') return await vault.recoveryOptions(p)
    if (route === 'POST recovery/commit') return await vault.recoveryCommit(p, body)
    if (route === 'POST requests') return await vault.request(p, body)
    if (path.length === 2 && path[0] === 'requests' && method === 'GET') return await vault.status(p, path[1]!)
    if (path.length === 3 && path[0] === 'requests' && path[2] === 'cancel' && method === 'POST') return await vault.cancel(p, path[1]!)
    if (path.length === 3 && path[0] === 'requests' && path[2] === 'deny' && method === 'POST') return await vault.deny(p, path[1]!)
    if (path.length === 3 && path[0] === 'approvals' && method === 'POST') {
      if (path[2] === 'collect') return await vault.collect(p, path[1]!, String(body.consumerId || ''))
      if (path[2] === 'revoke') return await vault.revoke(p, path[1]!)
    }
    if (method === 'DELETE' && path.length === 2 && ['secrets', 'credentials', 'consumers'].includes(path[0]!)) return await vault.remove(p, path[0] as 'secrets' | 'credentials' | 'consumers', path[1]!)
    throw new VaultError(404, 'Not found')
  }
  catch (err) {
    if (err instanceof VaultError) throw createError({ statusCode: err.status, statusMessage: err.message })
    // Never echo request bodies, extension data, or crypto-library diagnostics.
    throw createError({ statusCode: 400, statusMessage: 'Vault operation failed' })
  }
})
