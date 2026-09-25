import type { BrokeredGrant, OpenApeCliAuthorizationDetail } from '@openape/core'
import { sameBrokeredGrant } from '@openape/grants'
import type { AgentConnection } from '../broker/authorization'
import { connectionRequest, readJSON } from './http'

export async function approveRuntimeGrant(connection: AgentConnection, podId: string, grantId: string, bearer: string, signal: AbortSignal, allowed: () => boolean): Promise<void> {
  if (!/^[\w-]{1,128}$/.test(grantId) || !/^[a-f0-9-]{36}$/.test(podId)) throw new Error('Invalid runtime approval identity')
  const issuer = connection.decisionIssuer ?? connection.issuer
  const path = `/api/grants/${grantId}`
  const grant = await readJSON(await fetch(`${issuer}${path}`, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { Authorization: `Bearer ${bearer}` } }))
  const request = grant.request as Record<string, unknown> | undefined
  const permission = `pod-runtime.pod[id=${podId}]#run`
  const details = request?.authorization_details as OpenApeCliAuthorizationDetail[] | undefined
  const detail = Array.isArray(details) && details.length === 1 ? details[0] : undefined
  const resource = detail?.resource_chain?.length === 1 ? detail.resource_chain[0] : undefined
  if (grant.id !== grantId || request?.requester !== connection.subject || request?.audience !== 'shapes' || request?.target_host !== `pods:${podId}` || request.target_host !== connection.targetHost || request.grant_type !== 'always'
    || !Array.isArray(request.permissions) || request.permissions.length !== 1 || request.permissions[0] !== permission
    || detail?.type !== 'openape_cli' || detail.cli_id !== 'pod-runtime' || detail.operation_id !== 'run' || detail.action !== 'run' || detail.permission !== permission
    || resource?.resource !== 'pod' || resource.selector?.id !== podId || Object.keys(resource.selector).length !== 1
    || !sameBrokeredGrant(grant.brokered as BrokeredGrant | undefined, connection.brokered)) {
    throw new Error('Automatic approval requires the exact runtime permission for this Pod')
  }
  if (grant.status === 'approved') return
  if (grant.status !== 'pending') throw new Error(`Runtime permission ${String(grant.status)}; automatic approval cannot replace this decision`)
  signal.throwIfAborted()
  if (!allowed()) throw new Error('Automatic runtime approval was disabled before the decision')
  const result = await connectionRequest(issuer, `${path}/approve`, {}, signal, bearer)
  const approved = result.grant as { id?: string, status?: string } | undefined
  if (approved?.id !== grantId || approved.status !== 'approved') throw new Error('Runtime permission was not approved')
}
