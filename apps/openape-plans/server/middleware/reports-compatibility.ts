import { createError, defineEventHandler, getHeader, getMethod, getRequestURL, send, sendRedirect, setHeader, setResponseStatus } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { signPlansBridge } from '@openape/report-contracts/plans-bridge'
import { readCompatibilityBody } from '../utils/reports-compatibility-body'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(); const origin = String(config.reportsOrigin)
  const url = getRequestURL(event); const method = getMethod(event)
  const compatibilityApi = /^\/api\/(?:plans|teams|invites)(?:\/|$)/u.test(url.pathname)
  if (compatibilityApi && String(config.reportsWritesFrozen) === 'true' && !['GET', 'HEAD'].includes(method)) throw createError({ statusCode: 503, statusMessage: 'Plans writes are frozen for migration' })
  if (!origin) return
  const planPage = /^\/teams\/[^/]+\/plans\/([^/]+)(\/edit)?\/?$/u.exec(url.pathname)
  if (planPage && ['GET', 'HEAD'].includes(method)) return sendRedirect(event, `${origin}/d/${encodeURIComponent(planPage[1]!)}${planPage[2] ?? ''}${url.search}`, 302)
  if (!compatibilityApi) return
  const preview = method === 'GET' && /^\/api\/invites\/[^/]+$/u.test(url.pathname)
  const principal = preview ? null : await requireScopedPrincipal(event, [method === 'GET' ? 'plans:read' : 'plans:write'])
  if (principal?.authentication === 'session' && !['GET', 'HEAD'].includes(method) && getHeader(event, 'origin') !== url.origin) throw createError({ statusCode: 403, statusMessage: 'Matching Origin required' })
  const destination = new URL(origin)
  if (destination.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(destination.hostname)) throw createError({ statusCode: 503, statusMessage: 'Invalid Reports compatibility destination' })
  let raw = ''
  if (!['GET', 'HEAD'].includes(method) && getHeader(event, 'content-type') && getHeader(event, 'content-length') !== '0') raw = await readCompatibilityBody(event)
  const path = url.pathname.slice('/api'.length) + url.search
  const token = await signPlansBridge(String(config.reportsBridgeSecret), principal?.subject ?? null, principal?.actor ?? null, method, path, raw)
  const response = await fetch(`${origin}/api/plans-compat${path}`, { method, headers: { 'x-openape-plans-bridge': token, ...(raw ? { 'content-type': 'application/json' } : {}) }, body: raw || undefined, redirect: 'error', signal: AbortSignal.timeout(30000) })
  setResponseStatus(event, response.status)
  setHeader(event, 'cache-control', 'private, no-store'); setHeader(event, 'content-type', 'application/json'); setHeader(event, 'referrer-policy', 'no-referrer')
  return send(event, await response.text())
})
