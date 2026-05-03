import { defineCommand } from 'citty'
import WebSocket from 'ws'
import { getChatBearer } from '../auth'
import { getDefaultRoomId, getEndpoint } from '../config'
import { fmtTime, printLine, printNdjson } from '../output'
import type { Message, WsFrame } from '../types'

const PING_INTERVAL_MS = 30_000
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000

export const watchCommand = defineCommand({
  meta: {
    name: 'watch',
    description: 'Stream real-time room events via WebSocket. Pipe-friendly with --json (NDJSON).',
  },
  args: {
    room: {
      type: 'string',
      description: 'Filter to one room id (defaults to all rooms the caller is a member of)',
    },
    json: { type: 'boolean', default: false, description: 'Emit one frame per line as NDJSON' },
  },
  async run({ args }) {
    const filterRoomId = args.room ?? getDefaultRoomId(null)
    const endpoint = getEndpoint(null)
    const wsUrl = `${endpoint.replace(/^http/, 'ws')}/api/ws`

    if (!args.json) {
      printLine(`# watching ${filterRoomId ? `room ${filterRoomId}` : 'all rooms'} on ${endpoint}`)
      printLine('# Ctrl-C to stop')
    }

    let attempt = 0
    const state = { stop: false }

    const shutdown = () => {
      state.stop = true
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    while (!state.stop) {
      try {
        await connectAndPump(wsUrl, filterRoomId, args.json)
        attempt = 0
      }
      catch (err: unknown) {
        if (state.stop) return
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS)
        attempt++
        const msg = err instanceof Error ? err.message : String(err)
        if (!args.json) {
          printLine(`# disconnected (${msg}); reconnecting in ${Math.round(delay / 1000)}s`)
        }
        await sleep(delay)
      }
    }
  },
})

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function connectAndPump(
  wsUrl: string,
  filterRoomId: string | undefined,
  json: boolean,
): Promise<void> {
  const bearer = await getChatBearer()
  // Mint a fresh token per connect so we ride out long-running streams
  // across IdP-token refreshes (the token sits in the URL — chat.openape.ai
  // verifies it once at upgrade-time and reuses the resulting Caller).
  const token = bearer.replace(/^Bearer\s+/i, '')
  const url = `${wsUrl}?token=${encodeURIComponent(token)}`
  const ws = new WebSocket(url)

  return new Promise<void>((resolve, reject) => {
    let pingTimer: NodeJS.Timeout | undefined

    ws.on('open', () => {
      pingTimer = setInterval(() => ws.ping(), PING_INTERVAL_MS)
    })

    ws.on('message', (data: WebSocket.RawData) => {
      const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : ''
      if (!text) return
      let frame: WsFrame
      try {
        frame = JSON.parse(text) as WsFrame
      }
      catch {
        return
      }
      if (filterRoomId && frame.room_id !== filterRoomId) return
      renderFrame(frame, json)
    })

    ws.on('close', () => {
      if (pingTimer) clearInterval(pingTimer)
      resolve()
    })

    ws.on('error', (err: Error) => {
      if (pingTimer) clearInterval(pingTimer)
      reject(err)
    })
  })
}

function renderFrame(frame: WsFrame, json: boolean): void {
  if (json) {
    printNdjson(frame)
    return
  }
  if (frame.type === 'message') {
    const m = frame.payload as unknown as Message
    const actTag = m.senderAct === 'agent' ? '[agent]' : '       '
    printLine(`${fmtTime(m.createdAt)}  ${actTag} ${m.senderEmail}: ${m.body}`)
    return
  }
  printLine(`${frame.type} ${frame.room_id} ${JSON.stringify(frame.payload)}`)
}
