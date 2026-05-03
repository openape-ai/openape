// openape-chat-bridge
//
// Long-running daemon. Listens to chat.openape.ai via a WebSocket using the
// caller's IdP token (same path ape-chat watch uses), and for every inbound
// message that wasn't sent by the caller itself, shells out to a local LLM
// CLI (default: pi-coding-agent in --print mode), capturing its stdout and
// posting it back into the same room as a reply.
//
// Designed to run as an apes-spawned agent user that has done `apes login`
// once. The proxy / model config sits inside the LLM CLI extension — this
// bridge only knows about chat I/O and how to launch the CLI.
//
// Env knobs (all optional):
//   APE_CHAT_ENDPOINT      override https://chat.openape.ai
//   APE_CHAT_BRIDGE_CMD    LLM command to invoke (default: 'pi')
//   APE_CHAT_BRIDGE_ARGS   space-separated extra args (default:
//                          '--provider litellm --model gpt-5.4 --print')
//   APE_CHAT_BRIDGE_ROOM   restrict to one room id (default: all rooms the
//                          agent is a member of)
//   APE_CHAT_BRIDGE_TIMEOUT_MS  CLI timeout per message (default: 60000)

import { spawn } from 'node:child_process'
import process from 'node:process'
import { ensureFreshIdpAuth, NotLoggedInError } from '@openape/cli-auth'
import { decodeJwt } from 'jose'
import { ofetch } from 'ofetch'
import WebSocket from 'ws'

const DEFAULT_ENDPOINT = 'https://chat.openape.ai'
const DEFAULT_CMD = 'pi'
const DEFAULT_ARGS = '--provider litellm --model gpt-5.4 --print'
const DEFAULT_TIMEOUT_MS = 60_000

const PING_INTERVAL_MS = 30_000
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000

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

interface WsFrame {
  type: string
  room_id: string
  payload: Record<string, unknown>
}

interface BridgeConfig {
  endpoint: string
  cmd: string
  args: string[]
  roomFilter?: string
  timeoutMs: number
}

function readConfig(): BridgeConfig {
  const argsRaw = process.env.APE_CHAT_BRIDGE_ARGS ?? DEFAULT_ARGS
  return {
    endpoint: (process.env.APE_CHAT_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/$/, ''),
    cmd: process.env.APE_CHAT_BRIDGE_CMD ?? DEFAULT_CMD,
    args: argsRaw.split(/\s+/).filter(Boolean),
    roomFilter: process.env.APE_CHAT_BRIDGE_ROOM,
    timeoutMs: Number.parseInt(process.env.APE_CHAT_BRIDGE_TIMEOUT_MS ?? '', 10) || DEFAULT_TIMEOUT_MS,
  }
}

async function getIdentity(): Promise<{ email: string, bearer: string }> {
  const idp = await ensureFreshIdpAuth()
  const claims = decodeJwt(idp.access_token) as { sub?: string }
  if (!claims.sub) {
    throw new NotLoggedInError('IdP token has no sub claim — re-run `apes login` for this user.')
  }
  return { email: claims.sub, bearer: idp.access_token }
}

async function postMessage(
  cfg: BridgeConfig,
  bearer: string,
  roomId: string,
  body: string,
  replyTo?: string,
): Promise<void> {
  const url = `${cfg.endpoint}/api/rooms/${encodeURIComponent(roomId)}/messages`
  await ofetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}` },
    body: replyTo ? { body, reply_to: replyTo } : { body },
  })
}

function runLlm(cfg: BridgeConfig, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cfg.cmd, [...cfg.args, prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    const killer = setTimeout(() => child.kill('SIGKILL'), cfg.timeoutMs)
    child.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8') })
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8') })
    child.on('error', (err) => {
      clearTimeout(killer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(killer)
      if (code !== 0) {
        reject(new Error(`${cfg.cmd} exited ${code}: ${stderr.trim() || stdout.trim()}`))
        return
      }
      resolve(stdout.trim())
    })
  })
}

async function handleMessage(
  cfg: BridgeConfig,
  selfEmail: string,
  bearer: string,
  msg: Message,
): Promise<void> {
  if (msg.senderEmail === selfEmail) return
  if (!msg.body.trim()) return
  if (cfg.roomFilter && msg.roomId !== cfg.roomFilter) return

  log(`[${msg.roomId}] in: ${truncate(msg.body, 80)}`)

  let reply: string
  try {
    reply = await runLlm(cfg, msg.body)
  }
  catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    log(`[${msg.roomId}] LLM error: ${errMsg}`)
    reply = `(bridge error invoking ${cfg.cmd}: ${truncate(errMsg, 200)})`
  }

  if (!reply) {
    log(`[${msg.roomId}] empty reply, skipping`)
    return
  }

  try {
    await postMessage(cfg, bearer, msg.roomId, reply, msg.id)
    log(`[${msg.roomId}] out: ${truncate(reply, 80)}`)
  }
  catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    log(`[${msg.roomId}] post error: ${errMsg}`)
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return `${s.slice(0, n - 1)}…`
}

function log(line: string): void {
  process.stderr.write(`${new Date().toISOString()}  ${line}\n`)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function pumpOnce(
  cfg: BridgeConfig,
  identity: { email: string, bearer: string },
): Promise<void> {
  const wsUrl = `${cfg.endpoint.replace(/^http/, 'ws')}/api/ws?token=${encodeURIComponent(identity.bearer)}`
  const ws = new WebSocket(wsUrl)

  return new Promise<void>((resolve, reject) => {
    let pingTimer: NodeJS.Timeout | undefined

    ws.on('open', () => {
      log(`connected as ${identity.email} → ${cfg.endpoint}`)
      pingTimer = setInterval(() => ws.ping(), PING_INTERVAL_MS)
    })

    ws.on('message', (data: WebSocket.RawData) => {
      const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : ''
      if (!text) return
      let frame: WsFrame
      try { frame = JSON.parse(text) as WsFrame }
      catch { return }
      if (frame.type !== 'message') return
      // Don't await — handle messages concurrently so a slow LLM call doesn't
      // block other rooms. Errors are logged inside handleMessage.
      void handleMessage(cfg, identity.email, identity.bearer, frame.payload as unknown as Message)
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

async function main(): Promise<void> {
  const cfg = readConfig()
  const identity = await getIdentity()

  log(`bridge starting — cmd=${cfg.cmd} args=[${cfg.args.join(' ')}] room=${cfg.roomFilter ?? '*'}`)

  let attempt = 0
  while (true) {
    try {
      await pumpOnce(cfg, identity)
      attempt = 0
    }
    catch (err) {
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS)
      attempt++
      const msg = err instanceof Error ? err.message : String(err)
      log(`disconnected (${msg}) — reconnecting in ${Math.round(delay / 1000)}s`)
      await sleep(delay)
    }
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(`fatal: ${msg}\n`)
  process.exit(1)
})
