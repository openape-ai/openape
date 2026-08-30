import { createProblemError } from './problem'

export interface GraphFetch {
  (input: string, init?: RequestInit): Promise<Response>
}

export interface GraphAppConfig {
  clientId: string
  clientSecret: string
  tokenSecret: string
  publicUrl: string
  webhookUrl: string
  tenantId?: string
}

export const GRAPH_SCOPES = [
  'offline_access',
  'User.Read',
  'Mail.Read',
  'Mail.Send',
  'Calendars.ReadWrite',
  'OnlineMeetings.ReadWrite',
  'Files.ReadWrite',
].join(' ')

const GRAPH = 'https://graph.microsoft.com/v1.0'

function graphLoginBase(cfg: GraphAppConfig): string {
  const tenant = cfg.tenantId?.trim() || 'common'
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`
}

export function isGraphConfigured(cfg: GraphAppConfig): boolean {
  return Boolean(cfg.clientId && cfg.clientSecret && cfg.tokenSecret)
}

export function graphRedirectUri(cfg: GraphAppConfig): string {
  return `${cfg.publicUrl.replace(/\/$/, '')}/api/auth/microsoft/callback`
}

export function graphAuthorizeUrl(cfg: GraphAppConfig, state: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: graphRedirectUri(cfg),
    response_mode: 'query',
    scope: GRAPH_SCOPES,
    state,
  })
  return `${graphLoginBase(cfg)}/authorize?${q}`
}

export function requireGraphConfigured(cfg: GraphAppConfig): void {
  if (!isGraphConfigured(cfg)) {
    throw createProblemError({ status: 503, title: 'Microsoft verbinden', detail: 'Azure-App ist nicht konfiguriert.' })
  }
}

export function buildSendMailBody(opts: {
  to: string[]
  subject: string
  body: string
  attachments?: { name: string, contentType: string, contentBytes: string }[]
}) {
  return {
    message: {
      subject: opts.subject,
      body: { contentType: 'Text', content: opts.body },
      toRecipients: opts.to.map(address => ({ emailAddress: { address } })),
      attachments: (opts.attachments ?? []).map(a => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: a.name,
        contentType: a.contentType,
        contentBytes: a.contentBytes,
      })),
    },
    saveToSentItems: true,
  }
}

export function buildEventBody(opts: {
  subject: string
  start: string
  end: string
  attendees: string[]
}) {
  return {
    subject: opts.subject,
    start: { dateTime: opts.start, timeZone: 'UTC' },
    end: { dateTime: opts.end, timeZone: 'UTC' },
    isOnlineMeeting: true,
    onlineMeetingProvider: 'teamsForBusiness',
    attendees: opts.attendees.map(address => ({
      emailAddress: { address },
      type: 'required',
    })),
  }
}

export function folderPath(workspaceId: string, dealId: string): string {
  return `OpenApe CRM/${workspaceId}/${dealId}`
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

export async function exchangeCode(
  cfg: GraphAppConfig,
  code: string,
  fetchImpl: GraphFetch = fetch,
): Promise<TokenResponse> {
  return tokenRequest(cfg, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: graphRedirectUri(cfg),
  }, fetchImpl)
}

export function accessTokenFresh(expiresAt: number, now = Date.now(), skewMs = 60_000) {
  return expiresAt > now + skewMs
}

export async function refreshAccessToken(
  cfg: GraphAppConfig,
  refreshToken: string,
  fetchImpl: GraphFetch = fetch,
): Promise<TokenResponse> {
  return tokenRequest(cfg, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }, fetchImpl)
}

async function tokenRequest(
  cfg: GraphAppConfig,
  extra: Record<string, string>,
  fetchImpl: GraphFetch,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: GRAPH_SCOPES,
    ...extra,
  })
  const res = await fetchImpl(`${graphLoginBase(cfg)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    throw createProblemError({ status: 502, title: 'Microsoft-Token fehlgeschlagen' })
  }
  return await res.json() as TokenResponse
}

export async function graphJson<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
  fetchImpl: GraphFetch = fetch,
): Promise<T> {
  const res = await fetchImpl(`${GRAPH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!res.ok) {
    throw createProblemError({ status: 502, title: 'Microsoft Graph fehlgeschlagen', detail: text.slice(0, 400) })
  }
  return text ? JSON.parse(text) as T : undefined as T
}

export async function graphPut(
  accessToken: string,
  path: string,
  body: Buffer,
  contentType: string,
  fetchImpl: GraphFetch = fetch,
): Promise<{ id: string, webUrl: string, name: string, size?: number }> {
  const res = await fetchImpl(`${GRAPH}${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': contentType,
    },
    body: new Uint8Array(body),
  })
  if (!res.ok) {
    throw createProblemError({ status: 502, title: 'OneDrive-Upload fehlgeschlagen' })
  }
  return await res.json() as { id: string, webUrl: string, name: string, size?: number }
}

export function encodedDrivePath(segments: string[]): string {
  return segments.map(s => encodeURIComponent(s)).join('/')
}

export async function ensureDealFolder(
  accessToken: string,
  workspaceId: string,
  dealId: string,
  fetchImpl: GraphFetch = fetch,
): Promise<{ id: string, webUrl: string }> {
  const parts = ['OpenApe CRM', workspaceId, dealId]
  let parentPath = ''
  let last = { id: '', webUrl: '' }
  for (const part of parts) {
    const path = parentPath ? `${parentPath}/${part}` : part
    const encoded = encodedDrivePath(path.split('/'))
    try {
      last = await graphJson<{ id: string, webUrl: string }>(
        accessToken,
        `/me/drive/root:/${encoded}`,
        {},
        fetchImpl,
      )
    }
    catch {
      const parentEncoded = parentPath ? encodedDrivePath(parentPath.split('/')) : ''
      const createPath = parentPath
        ? `/me/drive/root:/${parentEncoded}:/children`
        : '/me/drive/root/children'
      last = await graphJson<{ id: string, webUrl: string }>(
        accessToken,
        createPath,
        {
          method: 'POST',
          body: JSON.stringify({
            name: part,
            folder: {},
            '@microsoft.graph.conflictBehavior': 'fail',
          }),
        },
        fetchImpl,
      )
    }
    parentPath = path
  }
  return last
}

export async function createOrgLink(
  accessToken: string,
  itemId: string,
  fetchImpl: GraphFetch = fetch,
): Promise<string | null> {
  const data = await graphJson<{ link?: { webUrl?: string } }>(
    accessToken,
    `/me/drive/items/${itemId}/createLink`,
    {
      method: 'POST',
      body: JSON.stringify({ type: 'view', scope: 'organization' }),
    },
    fetchImpl,
  )
  return data.link?.webUrl ?? null
}

export interface InboxMessage {
  id: string
  internetMessageId?: string
  subject?: string
  bodyPreview?: string
  body?: { content?: string, contentType?: string }
  from?: { emailAddress?: { address?: string, name?: string } }
  toRecipients?: { emailAddress?: { address?: string } }[]
  ccRecipients?: { emailAddress?: { address?: string } }[]
  receivedDateTime?: string
}

export async function listInbox(
  accessToken: string,
  fetchImpl: GraphFetch = fetch,
): Promise<InboxMessage[]> {
  const data = await graphJson<{ value: InboxMessage[] }>(
    accessToken,
    '/me/mailFolders/inbox/messages?$top=50&$orderby=receivedDateTime desc&$select=id,internetMessageId,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime',
    {},
    fetchImpl,
  )
  return data.value ?? []
}

export async function getMessage(
  accessToken: string,
  id: string,
  fetchImpl: GraphFetch = fetch,
): Promise<InboxMessage> {
  return graphJson(
    accessToken,
    `/me/messages/${encodeURIComponent(id)}?$select=id,internetMessageId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime`,
    { headers: { Prefer: 'outlook.body-content-type="text"' } },
    fetchImpl,
  )
}

export async function listEvents(
  accessToken: string,
  start: string,
  end: string,
  fetchImpl: GraphFetch = fetch,
) {
  const q = new URLSearchParams({
    startDateTime: start,
    endDateTime: end,
    $top: '50',
    $orderby: 'start/dateTime',
    $select: 'id,subject,start,end,webLink,onlineMeeting,location,organizer',
  })
  return graphJson<{ value: {
    id: string
    subject?: string
    start?: { dateTime?: string }
    end?: { dateTime?: string }
    webLink?: string
    onlineMeeting?: { joinUrl?: string }
    location?: { displayName?: string }
    organizer?: { emailAddress?: { address?: string, name?: string } }
  }[] }>(
    accessToken,
    `/me/calendarView?${q}`,
    {},
    fetchImpl,
  )
}

export async function listDriveChildren(
  accessToken: string,
  itemId: string | null,
  fetchImpl: GraphFetch = fetch,
) {
  const select = 'id,name,folder,webUrl,size,parentReference'
  const itemPath = itemId
    ? `/me/drive/items/${encodeURIComponent(itemId)}?$select=id,name,webUrl,parentReference`
    : '/me/drive/root?$select=id,name,webUrl,parentReference'
  const childrenPath = itemId
    ? `/me/drive/items/${encodeURIComponent(itemId)}/children?$select=${select}&$top=200`
    : `/me/drive/root/children?$select=${select}&$top=200`
  const [folder, kids] = await Promise.all([
    graphJson<{
      id: string
      name: string
      webUrl?: string
      parentReference?: { id?: string }
    }>(accessToken, itemPath, {}, fetchImpl),
    graphJson<{
      value: {
        id: string
        name: string
        folder?: unknown
        webUrl?: string
        size?: number
        parentReference?: { id?: string }
      }[]
    }>(accessToken, childrenPath, {}, fetchImpl),
  ])
  return { ...folder, children: kids.value ?? [] }
}

export async function createInboxSubscription(
  accessToken: string,
  notificationUrl: string,
  fetchImpl: GraphFetch = fetch,
): Promise<{ id: string, expirationDateTime: string }> {
  const expires = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
  return graphJson(
    accessToken,
    '/subscriptions',
    {
      method: 'POST',
      body: JSON.stringify({
        changeType: 'created',
        notificationUrl,
        resource: '/me/mailFolders/inbox/messages',
        expirationDateTime: expires,
        clientState: 'openape-crm',
      }),
    },
    fetchImpl,
  )
}
