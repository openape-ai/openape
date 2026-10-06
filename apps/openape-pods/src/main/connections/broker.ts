import type { BrokerConnection } from '@openape/core'
import { connectionRequest, readJSON } from './http'

export interface PodBrokerConnection { issuer: string, domain: string, connectionId: string }
async function providerEndpoint(issuer: string, field: string): Promise<string> {
  const discovery = await readJSON(await fetch(`${issuer}/.well-known/openid-configuration`, { redirect: 'error', signal: AbortSignal.timeout(10000) }))
  if (discovery.issuer !== issuer || discovery.openape_grant_brokering_version !== '1.0' || typeof discovery[field] !== 'string') throw new Error('This identity provider does not support agent provider connections; update its server before continuing')
  const endpoint = new URL(discovery[field])
  if (endpoint.origin !== issuer || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Agent provider endpoints must remain at their identity provider')
  return endpoint.pathname.replace(/\/$/, '')
}
export async function enablePodBroker(decisionIssuer: string, owner: string, issuer: string, domain: string, bearer: string, signal: AbortSignal): Promise<PodBrokerConnection> {
  const endpoint = await providerEndpoint(decisionIssuer, 'openape_broker_connections_endpoint')
  const reply = await connectionRequest(decisionIssuer, endpoint, { broker_issuer: issuer, agent_domain: domain }, signal, bearer)
  const connection = reply as unknown as BrokerConnection
  if (!/^[a-f0-9-]{36}$/.test(connection.id) || connection.status !== 'active' || connection.owner?.issuer !== decisionIssuer || connection.owner.subject !== owner || connection.broker_issuer !== issuer || connection.agent_domain !== domain) throw new Error('Broker consent does not match the selected owner and provider')
  return { issuer, domain, connectionId: connection.id }
}
export async function revokePodBroker(decisionIssuer: string, connection: PodBrokerConnection, bearer: string, signal: AbortSignal): Promise<void> {
  const endpoint = await providerEndpoint(decisionIssuer, 'openape_broker_connections_endpoint')
  const response = await fetch(`${decisionIssuer}${endpoint}/${encodeURIComponent(connection.connectionId)}`, { method: 'DELETE', redirect: 'error', signal, headers: { Authorization: `Bearer ${bearer}` } })
  if (!response.ok) throw new Error(`Broker revocation failed (${response.status}); review the connection at your identity provider`)
}
export async function podBrokerReceipt(decisionIssuer: string, connection: PodBrokerConnection, bearer: string, signal: AbortSignal): Promise<string> {
  const endpoint = await providerEndpoint(decisionIssuer, 'openape_broker_connections_endpoint')
  const reply = await connectionRequest(decisionIssuer, `${endpoint}/${encodeURIComponent(connection.connectionId)}/receipt`, {}, signal, bearer)
  if (typeof reply.connection_receipt !== 'string' || reply.connection_receipt.length > 16384) throw new Error('The owner identity provider did not return a connection receipt')
  return reply.connection_receipt
}
export async function enrollBrokerAgent(issuer: string, body: unknown): Promise<Record<string, unknown>> {
  const endpoint = await providerEndpoint(issuer, 'openape_broker_enrollment_endpoint')
  return connectionRequest(issuer, endpoint, body, AbortSignal.timeout(10000))
}
