// GET /api/agents/<name>/chat-proxy — fetches the operator's existing
// chat.openape.ai history for this agent. Interim: until we cut the
// bridges over to troop's native chat backend (M5/M6 of plan
// 01KSWSHPA4C320VV0BKK98EZ0V), this proxies the user-facing chat tab
// against the existing chat service.
//
// Authentication: the troop session-cookie identifies the operator.
// We forward an ID-token-style assertion to chat.openape.ai by minting
// a short-lived HS256 ws-token via chat's `/api/ws-token` endpoint —
// but the simpler path: chat.openape.ai accepts the user's
// session-cookie IF they have one (cross-subdomain). For server-side
// proxy, simplest is to forward the cookie header.
//
// Same-subdomain assumption: troop.openape.ai + chat.openape.ai. The
// session cookie for chat may or may not exist; when missing, we return
// 412 telling the UI to redirect to chat.openape.ai/login once.

import { requireOwner } from '../../../../utils/auth'
import { ofetch } from 'ofetch'

interface ChatContact {
  peerEmail: string
  roomId: string | null
}

interface ChatThread {
  id: string
  name: string
  archivedAt: number | null
}

interface ChatMessage {
  id: string
  roomId: string
  threadId: string | null
  senderEmail: string
  senderAct: 'human' | 'agent'
  body: string
  replyTo: string | null
  createdAt: number
  editedAt: number | null
  streaming: boolean
  streamingStatus: string | null
}

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const agentName = getRouterParam(event, 'name')
  if (!agentName) throw createError({ statusCode: 400, statusMessage: 'Missing agent name' })

  const chatBase = (useRuntimeConfig().public.chatUrl as string | undefined)
    ?? 'https://chat.openape.ai'
  // Forward the operator's cookie header to chat.openape.ai. When both
  // services share the parent domain (.openape.ai), the operator's chat
  // session cookie travels here unchanged.
  const cookie = getHeader(event, 'cookie') ?? ''
  if (!cookie) {
    throw createError({ statusCode: 412, statusMessage: 'No chat session cookie; visit chat.openape.ai once to log in.' })
  }

  // Step 1: find the contact whose peerEmail starts with `<agentName>-`
  // (DDISA agent email format: <name>-<owner-hash>+<owner>@id.openape.ai).
  let contacts: ChatContact[]
  try {
    contacts = await ofetch<ChatContact[]>(`${chatBase}/api/contacts`, {
      headers: { cookie },
    })
  }
  catch (err) {
    const status = (err as { status?: number }).status ?? 502
    throw createError({ statusCode: status === 401 ? 412 : 502, statusMessage: 'chat.openape.ai contact lookup failed' })
  }
  const agentContact = contacts.find(c => c.peerEmail.startsWith(`${agentName}-`) && c.roomId != null)
  if (!agentContact || !agentContact.roomId) {
    return { roomId: null, threadId: null, messages: [] }
  }

  // Step 2: find the main thread.
  const threads = await ofetch<ChatThread[]>(`${chatBase}/api/rooms/${agentContact.roomId}/threads`, {
    headers: { cookie },
  })
  const mainThread = threads.find(t => t.name === 'main') ?? threads[0]
  if (!mainThread) return { roomId: agentContact.roomId, threadId: null, messages: [] }

  // Step 3: pull the most recent 50 messages of that thread.
  const messages = await ofetch<ChatMessage[]>(
    `${chatBase}/api/rooms/${agentContact.roomId}/messages?thread_id=${mainThread.id}&limit=50`,
    { headers: { cookie } },
  )

  return {
    roomId: agentContact.roomId,
    threadId: mainThread.id,
    messages: messages.slice().reverse(),
  }
})
