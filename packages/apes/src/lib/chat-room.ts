// Helpers for `apes agents spawn --bridge`. Hits chat.openape.ai's REST
// API as the spawning user (uses their IdP bearer) to send a contact
// request to the freshly-created agent. The bridge daemon, on its first
// boot, picks up the pending request and accepts on the agent's behalf
// — so the human ↔ agent connection establishes a few seconds after
// spawn finishes, without manual intervention on either side.
//
// Plain fetch here so apes stays free of a runtime npm dep on
// @openape/ape-chat.

const DEFAULT_CHAT_ENDPOINT = 'https://chat.openape.ai'

interface ContactView {
  peerEmail: string
  myStatus: 'accepted' | 'pending' | 'blocked'
  theirStatus: 'accepted' | 'pending' | 'blocked'
  connected: boolean
  roomId: string | null
}

function chatEndpoint(): string {
  return (process.env.APE_CHAT_ENDPOINT ?? DEFAULT_CHAT_ENDPOINT).replace(/\/$/, '')
}

async function chatFetch<T>(
  bearer: string,
  path: string,
  init?: { method?: string, body?: unknown },
): Promise<T> {
  const url = `${chatEndpoint()}${path}`
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`chat.openape.ai ${init?.method ?? 'GET'} ${path} → ${res.status}: ${detail.slice(0, 200)}`)
  }
  if (res.status === 204) return null as unknown as T
  return await res.json() as T
}

/**
 * Send a contact request from the caller (spawning user) to the new
 * agent. The agent's bridge will pick it up on first boot and accept
 * on its own behalf, completing the bilateral handshake. Idempotent.
 */
export async function requestContactWithAgent(opts: {
  callerBearer: string
  agentEmail: string
}): Promise<ContactView> {
  return chatFetch<ContactView>(opts.callerBearer, '/api/contacts', {
    method: 'POST',
    body: { email: opts.agentEmail },
  })
}
