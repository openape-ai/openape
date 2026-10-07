import { getHeader, getRequestURL, setHeader, useSession } from 'h3'
import type { H3Event } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { parseOwner, ProtocolError } from '@openape/pods-protocol'
import type { Owner } from '@openape/pods-protocol'
import { InboxStore } from './inbox-store'
import type { InboxDevice } from './inbox-types'
import { assertEnrolled, workspaceOrigin, workspaceSession } from './workspace'

let instance: InboxStore | undefined
export function inboxStore(): InboxStore {
  const config = useRuntimeConfig()
  if (!config.inboxEnabled) throw new ProtocolError('inbox_disabled', 503)
  instance ??= new InboxStore(String(config.inboxDatabase))
  return instance
}

// A phone stays signed in for 30 days (absolute); each request re-checks that its device was not revoked.
async function inboxCookie(event: H3Event) {
  await workspaceSession(event) // fails closed when the session secrets are not configured
  return useSession<{ owner?: Owner, deviceId?: string }>(event, { name: 'pods-inbox', password: String(useRuntimeConfig().workspaceSessionSecret), maxAge: 30 * 86400, cookie: { httpOnly: true, secure: getRequestURL(event).protocol === 'https:', sameSite: 'lax', path: '/inbox/' } })
}

// Resolves the signed-in human and their inbox device. A fresh DDISA workspace sign-in registers a new device.
export async function inboxCaller(event: H3Event): Promise<{ owner: Owner, device: InboxDevice }> {
  setHeader(event, 'cache-control', 'private, no-store')
  const store = inboxStore()
  if (event.method !== 'GET') workspaceOrigin(event)
  const cookie = await inboxCookie(event)
  if (cookie.data.owner && cookie.data.deviceId) {
    const owner = assertEnrolled(parseOwner(cookie.data.owner))
    const device = store.activeDevice(owner, cookie.data.deviceId)
    if (device) return { owner, device }
    await signOut(event)
    throw new ProtocolError('session_revoked', 401)
  }
  const workspace = await workspaceSession(event)
  if (!workspace.data.owner) throw new ProtocolError('authentication_required', 401)
  const owner = assertEnrolled(parseOwner(workspace.data.owner))
  const device = store.registerDevice(owner, getHeader(event, 'user-agent') ?? '')
  await cookie.update({ owner, deviceId: device.id })
  return { owner, device }
}

export async function signOut(event: H3Event): Promise<void> {
  await (await inboxCookie(event)).clear()
  await (await workspaceSession(event)).clear()
}
