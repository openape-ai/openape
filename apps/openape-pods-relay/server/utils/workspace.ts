import { getHeader, getRequestURL, setHeader, useSession } from 'h3'
import type { H3Event } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { parseOwner, ProtocolError, sameOwner } from '@openape/pods-protocol'
import type { Owner } from '@openape/pods-protocol'
import { sha256 } from '@openape/pods-protocol/crypto'
import { centralMaxBytes } from '../../../openape-pods/src/contracts/central'
import { WorkspaceStore } from './workspace-store'

let instance: WorkspaceStore | undefined
export function workspace(): WorkspaceStore {
  const config = useRuntimeConfig()
  if (!config.workspaceEnabled) throw new ProtocolError('workspace_disabled', 503)
  instance ??= new WorkspaceStore(String(config.workspaceDatabase))
  return instance
}

export function workspaceOrigin(event: H3Event): void {
  if (getHeader(event, 'origin') !== String(useRuntimeConfig().relayOrigin)) throw new ProtocolError('invalid_origin', 403)
}

export async function workspaceSession(event: H3Event) {
  workspace()
  const password = String(useRuntimeConfig().workspaceSessionSecret)
  const flowSecret = String(useRuntimeConfig().openapeSp.sessionSecret)
  if (flowSecret.length < 32 || /^(?:dev-|change-me|please-change)/i.test(flowSecret)) throw new ProtocolError('workspace_flow_unconfigured', 503)
  if (password.length < 32) throw new ProtocolError('workspace_session_unconfigured', 503)
  return useSession<{ owner?: Owner }>(event, { name: 'pods-workspace', password, maxAge: 86400, cookie: { httpOnly: true, secure: getRequestURL(event).protocol === 'https:', sameSite: 'lax', path: '/' } })
}

export async function workspaceOwner(event: H3Event): Promise<Owner> {
  setHeader(event, 'cache-control', 'private, no-store')
  const session = await workspaceSession(event)
  if (!session.data.owner) throw new ProtocolError('authentication_required', 401)
  if (event.method !== 'GET') workspaceOrigin(event)
  const owner = parseOwner(session.data.owner)
  const config = useRuntimeConfig()
  if (config.relayEnrollment !== 'public' && !(config.relayEnrollment === 'pilot' && config.relayOwnerAllowlist.map(parseOwner).some(item => sameOwner(item, owner)))) throw new ProtocolError('enrollment_closed', 403)
  return owner
}

export async function workspaceBody(event: H3Event, maximum = centralMaxBytes): Promise<unknown> {
  if (!getHeader(event, 'content-type')?.startsWith('application/json')) throw new ProtocolError('json_required', 415)
  if (Number(getHeader(event, 'content-length') ?? 0) > maximum) throw new ProtocolError('workspace_too_large', 413)
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of event.node.req) {
    const bytes = Buffer.from(chunk); size += bytes.length
    if (size > maximum) throw new ProtocolError('workspace_too_large', 413)
    chunks.push(bytes)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (event.context.podsBodyDigest && sha256(raw) !== event.context.podsBodyDigest) throw new ProtocolError('invalid_request_body', 401)
  try { return JSON.parse(raw) }
  catch { throw new ProtocolError('invalid_json') }
}

export async function workspaceBoundary<T>(run: () => T | Promise<T>): Promise<T> {
  try { return await run() }
  catch (error) {
    if (error instanceof ProtocolError) throw error
    if (error instanceof Error && /^(?:Invalid |Unsupported |Expected |This action|Script belongs)/.test(error.message)) throw new ProtocolError('invalid_workspace_request')
    throw error
  }
}
