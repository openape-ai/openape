import { ref } from 'vue'

interface Message {
  id: string
  roomId: string
  senderEmail: string
  senderAct: 'human' | 'agent'
  body: string
  replyTo: string | null
  createdAt: number
  editedAt: number | null
}

interface Reaction {
  messageId: string
  userEmail: string
  emoji: string
  createdAt: number
}

interface ChatFrame {
  type:
    | 'message' | 'reaction' | 'reaction-removed' | 'edit'
    | 'membership-added' | 'membership-changed' | 'membership-removed'
    | 'hello' | 'error'
  room_id?: string
  payload?: Message | Reaction | { messageId: string, userEmail: string, emoji: string } | Record<string, unknown>
  email?: string
  message?: string
}

type Listener = (frame: ChatFrame) => void

interface UseChatHandle {
  connected: ReturnType<typeof ref<boolean>>
  on: (fn: Listener) => () => void
  // Cookie-session callers don't need to pass a token — connect() mints one
  // via /api/ws-token. Agent/plugin callers can pass their JWKS-signed
  // bearer directly to skip the round-trip.
  connect: (opts?: { token?: string }) => Promise<void>
  disconnect: () => void
  // Send a frame to the server. Safe to call before/after connect — no-op
  // when the socket isn't open. Used by rooms/[id] to emit focus/blur
  // frames so the server can suppress push for the active surface.
  send: (frame: Record<string, unknown>) => void
}

let _instance: UseChatHandle | null = null

export function useChat(): UseChatHandle {
  if (_instance) return _instance

  const connected = ref(false)
  const listeners = new Set<Listener>()
  let socket: WebSocket | null = null
  let reconnectAttempts = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let manualDisconnect = false
  let lastToken: string | undefined

  function buildUrl(token?: string): string {
    if (typeof window === 'undefined') return ''
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = new URL(`${proto}//${window.location.host}/api/ws`)
    if (token) url.searchParams.set('token', token)
    return url.toString()
  }

  function scheduleReconnect() {
    if (manualDisconnect) return
    if (reconnectTimer) return
    const delay = Math.min(30_000, 500 * 2 ** Math.min(reconnectAttempts, 6))
    reconnectAttempts += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      open(lastToken)
    }, delay)
  }

  function open(token?: string) {
    if (typeof window === 'undefined') return
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return
    }
    lastToken = token
    socket = new WebSocket(buildUrl(token))

    socket.addEventListener('open', () => {
      connected.value = true
      reconnectAttempts = 0
    })
    socket.addEventListener('close', () => {
      connected.value = false
      socket = null
      scheduleReconnect()
    })
    socket.addEventListener('error', () => {
      // The browser also fires 'close' after 'error'; let scheduleReconnect
      // run from the close handler instead of double-scheduling here.
    })
    socket.addEventListener('message', (e) => {
      try {
        const frame = JSON.parse(e.data as string) as ChatFrame
        for (const fn of listeners) {
          try { fn(frame) }
          catch { /* listener errors must not poison the dispatch loop */ }
        }
      }
      catch {
        // Malformed frame from server — ignore.
      }
    })
  }

  function on(fn: Listener) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  async function connect(opts?: { token?: string }) {
    manualDisconnect = false
    let token = opts?.token
    // Cookie-session callers (the Web UI) need a short-lived WS token —
    // browsers can't put Authorization on the WS upgrade. The endpoint is
    // cookie-authenticated, so any signed-in user can mint one.
    if (!token) {
      try {
        const res = await $fetch<{ token: string }>('/api/ws-token')
        token = res.token
      }
      catch {
        // Couldn't mint a token (e.g. session expired) — let the WS open
        // anyway and rely on the server-side 401 to surface.
      }
    }
    open(token)
  }

  function send(frame: Record<string, unknown>) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    try { socket.send(JSON.stringify(frame)) }
    catch { /* socket race — fine, next reconnect will re-sync state */ }
  }

  function disconnect() {
    manualDisconnect = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    socket?.close()
    socket = null
    connected.value = false
  }

  _instance = { connected, on, connect, disconnect, send }
  return _instance
}
