import { defineEventHandler, getQuery, getRouterParam, readBody } from 'h3'
import { requireBrokerOwner } from '../../utils/broker-owner'
import { publishOwnerShape } from '../../utils/owner-shapes'

/**
 * PUT /api/shapes/:cliId  body `{ "toml": "<adapter.toml>" }`
 *
 * Publishes the signed-in human owner's own shape (issue 1551); with
 * `?dry_run=1` only previews it. Agents, Pods, delegations and brokered
 * sessions cannot publish, so no requester can widen its own grants.
 */
export default defineEventHandler(async (event) => {
  const owner = await requireBrokerOwner(event, true)
  const cliId = decodeURIComponent(getRouterParam(event, 'cliId') ?? '')
  const body = await readBody<{ toml?: unknown }>(event)
  const dryRun = ['1', 'true'].includes(String(getQuery(event).dry_run ?? ''))
  return await publishOwnerShape(owner, cliId, body?.toml, dryRun)
})
