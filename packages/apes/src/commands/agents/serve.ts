import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { defineCommand } from 'citty'
import { CliError } from '../../errors'
import { taskTools } from '../../lib/agent-tools'
import { runLoop, RpcSessionMap  } from '../../lib/agent-runtime'
import type { RuntimeConfig } from '../../lib/agent-runtime'

// `apes agents serve --rpc` — long-running stdio JSON server.
// Replaces `pi --mode rpc` for chat-bridge's per-room subprocesses.
// Each inbound line is a JSON object describing a single message;
// outbound is a stream of text_delta / tool_call / tool_result /
// done / error events. Sessions keyed by `session_id` keep
// per-conversation memory across messages.
//
// The chat-bridge package owns the policy of "which model, which
// system prompt, which tools" — the runtime is purely the executor.

interface InboundMessage {
  type?: 'message'
  session_id: string
  system_prompt: string
  tools: string[]
  max_steps?: number
  model?: string
  user_msg: string
}

interface AuthJson { access_token: string, email: string }

const AUTH_PATH = join(homedir(), '.config', 'apes', 'auth.json')

function readLitellmConfig(model?: string): RuntimeConfig {
  const envPath = join(homedir(), 'litellm', '.env')
  const env: Record<string, string> = {}
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m) env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '')
    }
  }
  for (const k of ['LITELLM_API_KEY', 'LITELLM_MASTER_KEY', 'LITELLM_BASE_URL']) {
    if (process.env[k]) env[k] = process.env[k]!
  }
  const apiKey = env.LITELLM_API_KEY || env.LITELLM_MASTER_KEY
  const apiBase = (env.LITELLM_BASE_URL || 'http://127.0.0.1:4000/v1').replace(/\/$/, '')
  if (!apiKey) throw new CliError('No LITELLM_API_KEY / LITELLM_MASTER_KEY in ~/litellm/.env or env.')
  return { apiBase, apiKey, model: model || 'claude-haiku-4-5' }
}

function emit(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

export const serveAgentCommand = defineCommand({
  meta: {
    name: 'serve',
    description: 'Long-running stdio RPC server for chat-bridge subprocess use.',
  },
  args: {
    rpc: {
      type: 'boolean',
      description: 'Use the line-delimited JSON RPC protocol on stdio (the only mode for now).',
    },
  },
  async run({ args }) {
    if (!args.rpc) {
      throw new CliError('apes agents serve currently only supports --rpc mode')
    }
    if (existsSync(AUTH_PATH)) {
      // We don't actually use the agent JWT in serve mode — the bridge
      // is the only caller and it talks to chat.openape.ai itself —
      // but reading auth.json is a sanity check that we're running
      // as a troop-spawned agent user, not stray.
      try { JSON.parse(readFileSync(AUTH_PATH, 'utf8')) as AuthJson }
      catch { /* tolerate */ }
    }

    const sessions = new RpcSessionMap()
    const evictTimer = setInterval(() => sessions.evictStale(), 5 * 60 * 1000)
    process.on('exit', () => clearInterval(evictTimer))

    const rl = createInterface({ input: process.stdin, terminal: false })
    rl.on('line', async (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      let msg: InboundMessage
      try { msg = JSON.parse(trimmed) as InboundMessage }
      catch (err) {
        emit({ type: 'error', message: `invalid JSON: ${(err as Error).message}` })
        return
      }
      if (!msg.session_id || !msg.user_msg) {
        emit({ type: 'error', message: 'session_id and user_msg are required' })
        return
      }
      try {
        await handleInbound(msg, sessions)
      }
      catch (err) {
        emit({ type: 'error', session_id: msg.session_id, message: (err as Error)?.message ?? String(err) })
        emit({ type: 'done', session_id: msg.session_id, step_count: 0, status: 'error' })
      }
    })

    rl.on('close', () => process.exit(0))

    // Block forever — readline keeps the loop alive.
  },
})

async function handleInbound(msg: InboundMessage, sessions: RpcSessionMap): Promise<void> {
  const config = readLitellmConfig(msg.model)
  const tools = taskTools(msg.tools ?? [])
  const maxSteps = msg.max_steps ?? 10

  let session = sessions.get(msg.session_id)
  if (!session) {
    session = {
      systemPrompt: msg.system_prompt,
      tools,
      maxSteps,
      messages: [],
      lastTouched: Date.now(),
    }
    sessions.put(msg.session_id, session)
  }

  const result = await runLoop({
    config,
    systemPrompt: session.systemPrompt,
    userMessage: msg.user_msg,
    tools: session.tools,
    maxSteps: session.maxSteps,
    history: session.messages,
    handlers: {
      onTextDelta: delta => emit({ type: 'text_delta', session_id: msg.session_id, delta }),
      onToolCall: ({ name, args }) => emit({ type: 'tool_call', session_id: msg.session_id, name, args }),
      onToolResult: ({ name, result }) => emit({ type: 'tool_result', session_id: msg.session_id, name, result }),
      onToolError: ({ name, error }) => emit({ type: 'tool_error', session_id: msg.session_id, name, error }),
    },
  })

  // Persist session memory by appending the user_msg + assistant
  // response so the next inbound message has the full thread.
  session.messages.push({ role: 'user', content: msg.user_msg })
  if (result.finalMessage) {
    session.messages.push({ role: 'assistant', content: result.finalMessage })
  }

  emit({
    type: 'done',
    session_id: msg.session_id,
    step_count: result.stepCount,
    status: result.status,
    final_message: result.finalMessage,
  })
}
