import { randomBytes } from 'node:crypto'
import { defineEventHandler, getQuery, sendRedirect, setCookie } from 'h3'
import { graphAppConfig } from '../../utils/graph-account'
import { graphAuthorizeUrl, requireGraphConfigured } from '../../utils/graph'

export default defineEventHandler(async (event) => {
  await requireCaller(event)
  const cfg = graphAppConfig()
  requireGraphConfigured(cfg)
  const state = randomBytes(16).toString('hex')
  const workspaceId = String(getQuery(event).workspace_id ?? '')
  setCookie(event, 'oa_graph_state', `${state}.${workspaceId}`, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return sendRedirect(event, graphAuthorizeUrl(cfg, state))
})
