import { randomUUID } from 'node:crypto'
import { clearSession, getHeader, getRequestURL, getSession, setHeader, updateSession } from 'h3'
import type { H3Event, SessionConfig } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { parseOwner, ProtocolError } from '@openape/pods-protocol'
import type { Owner } from '@openape/pods-protocol'
import { InboxStore } from './inbox-store'
import type { InboxDevice } from './inbox-types'
import { assertEnrolled, workspaceOrigin, workspaceSession } from './workspace'

interface InboxSessionData { owner?: Owner, deviceId?: string }
let instance: InboxStore | undefined
export function inboxStore(): InboxStore {
  const config = useRuntimeConfig()
  if (!config.inboxEnabled) throw new ProtocolError('inbox_disabled', 503)
  instance ??= new InboxStore(String(config.inboxDatabase))
  return instance
}

// A phone stays signed in for 30 days (absolute); each request re-checks that its device was not revoked.
// Path `/` so the sign-in callback and workspace logout receive the cookie and can revoke the device.
async function cookieConfig(event: H3Event): Promise<SessionConfig> {
  await workspaceSession(event) // fails closed when the session secrets are not configured
  return { name: 'pods-inbox', password: String(useRuntimeConfig().workspaceSessionSecret), maxAge: 30 * 86400, cookie: { httpOnly: true, secure: getRequestURL(event).protocol === 'https:', sameSite: 'lax', path: '/' } }
}

// Resolves the signed-in human and their active inbox device. Only a DDISA sign-in started by the inbox creates one.
export async function inboxCaller(event: H3Event): Promise<{ owner: Owner, device: InboxDevice }> {
  setHeader(event, 'cache-control', 'private, no-store')
  const store = inboxStore()
  if (event.method !== 'GET') workspaceOrigin(event)
  const config = await cookieConfig(event)
  const { owner, deviceId } = (await getSession<InboxSessionData>(event, config)).data
  if (!owner || !deviceId) throw new ProtocolError('authentication_required', 401)
  const enrolled = assertEnrolled(parseOwner(owner))
  const device = store.activeDevice(enrolled, deviceId)
  if (device) return { owner: enrolled, device }
  await clearSession(event, config)
  throw new ProtocolError('session_revoked', 401)
}

// Called from the DDISA callback only. Replaces any previous inbox device of this browser.
export async function startInboxDevice(event: H3Event, owner: Owner): Promise<void> {
  if (!useRuntimeConfig().inboxEnabled) return
  await endInboxDevice(event)
  const config = await cookieConfig(event)
  const device = inboxStore().registerDevice(owner, getHeader(event, 'user-agent') ?? '')
  // h3 would re-read the old request cookie and keep its creation time; start from a fresh session object instead.
  event.context.sessions = { ...event.context.sessions, [config.name!]: { id: randomUUID(), createdAt: Date.now(), data: {} } }
  await updateSession<InboxSessionData>(event, config, { owner, deviceId: device.id })
}

// Revokes this browser's inbox device (if any) and removes its cookie; used by every sign-in and sign-out.
export async function endInboxDevice(event: H3Event): Promise<void> {
  if (!useRuntimeConfig().inboxEnabled) return
  const config = await cookieConfig(event)
  const { owner, deviceId } = (await getSession<InboxSessionData>(event, config)).data
  if (owner && deviceId) {
    try { inboxStore().revokeDevice(parseOwner(owner), deviceId) }
    catch (error) { if (!(error instanceof ProtocolError && error.status === 404)) throw error }
  }
  await clearSession(event, config)
}

export async function signOut(event: H3Event): Promise<void> {
  await endInboxDevice(event)
  await (await workspaceSession(event)).clear()
}
