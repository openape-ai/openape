import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineCommand } from 'citty'
import consola from 'consola'
import { CliError } from '../../errors'
import { taskTools } from '../../lib/agent-tools'
import { runLoop  } from '../../lib/agent-runtime'
import type { RuntimeConfig } from '../../lib/agent-runtime'
import { resolveTroopUrl, TroopClient  } from '../../lib/troop-client'
import type { TaskSpec } from '../../lib/troop-client'

const AUTH_PATH = join(homedir(), '.config', 'apes', 'auth.json')
const TASK_CACHE_DIR = join(homedir(), '.openape', 'agent', 'tasks')

interface AuthJson { access_token: string, email: string, owner_email?: string }

function readAuth(): AuthJson {
  if (!existsSync(AUTH_PATH)) {
    throw new CliError(`No agent auth found at ${AUTH_PATH}. Run \`apes agents spawn <name>\` first.`)
  }
  const parsed = JSON.parse(readFileSync(AUTH_PATH, 'utf8')) as AuthJson
  if (!parsed.access_token) throw new CliError('auth.json missing access_token')
  return parsed
}

/**
 * Post the run result as a chat DM from the agent to its owner. Best-
 * effort: any failure (no room yet because owner hasn't accepted the
 * contact request, chat down, network, …) just logs and returns. The
 * run record on troop is still authoritative; the chat DM is the
 * convenience surface so the owner sees the answer in the same
 * conversation thread they'd expect to ask about it.
 */
async function postRunResultToChat(opts: {
  authToken: string
  ownerEmail: string
  taskName: string
  status: 'ok' | 'error'
  stepCount: number
  finalMessage: string | null
  endpoint?: string
}): Promise<void> {
  const endpoint = (opts.endpoint ?? process.env.APE_CHAT_ENDPOINT ?? 'https://chat.openape.ai').replace(/\/$/, '')
  try {
    // Find the room with the owner. The bridge sets up the contact
    // relationship on first boot — if the owner hasn't accepted yet,
    // there's no room and we silently no-op.
    const contactsRes = await fetch(`${endpoint}/api/contacts`, {
      headers: { Authorization: `Bearer ${opts.authToken}` },
    })
    if (!contactsRes.ok) return
    const contacts = await contactsRes.json() as Array<{ peerEmail: string, roomId: string | null, connected: boolean }>
    const ownerLower = opts.ownerEmail.toLowerCase()
    const ownerRow = contacts.find(c => c.peerEmail.toLowerCase() === ownerLower && c.connected && c.roomId)
    if (!ownerRow?.roomId) {
      consola.info('chat DM skipped — no active room with owner (accept the contact request in chat to enable)')
      return
    }
    const prefix = opts.status === 'ok' ? '✅' : '❌'
    const msg = opts.finalMessage?.trim() || (opts.status === 'ok' ? '(no output)' : '(crashed)')
    const body = `${prefix} *${opts.taskName}* (${opts.stepCount} steps)\n\n${msg}`.slice(0, 9000)
    const postRes = await fetch(`${endpoint}/api/rooms/${encodeURIComponent(ownerRow.roomId)}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${opts.authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    if (!postRes.ok) {
      consola.warn(`chat DM post failed: ${postRes.status}`)
    }
  }
  catch (err) {
    consola.warn(`chat DM error: ${(err as Error).message}`)
  }
}

function readTaskSpec(taskId: string): TaskSpec {
  const path = join(TASK_CACHE_DIR, `${taskId}.json`)
  if (!existsSync(path)) {
    throw new CliError(`No cached task spec at ${path}. Run \`apes agents sync\` first to pull the task list from troop.`)
  }
  return JSON.parse(readFileSync(path, 'utf8')) as TaskSpec
}

interface AgentJson { systemPrompt: string }
const AGENT_CONFIG_PATH = join(homedir(), '.openape', 'agent', 'agent.json')

/**
 * Read the cached agent-level config (systemPrompt). Falls back to an
 * empty systemPrompt if the file is missing — older agents written
 * before the system-prompt refactor (#346) won't have one yet, and the
 * next sync will create it. Empty systemPrompt is fine: the runtime
 * just sends the user message with no system message.
 */
function readAgentConfig(): AgentJson {
  if (!existsSync(AGENT_CONFIG_PATH)) return { systemPrompt: '' }
  try { return JSON.parse(readFileSync(AGENT_CONFIG_PATH, 'utf8')) as AgentJson }
  catch { return { systemPrompt: '' } }
}

function readLitellmConfig(model?: string): RuntimeConfig {
  // ~/litellm/.env carries LITELLM_API_KEY (or LITELLM_MASTER_KEY) +
  // LITELLM_BASE_URL — same file `apes agents spawn` writes during
  // the bridge bootstrap. The agent's macOS user owns the file.
  const envPath = join(homedir(), 'litellm', '.env')
  const env: Record<string, string> = {}
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m) env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '')
    }
  }
  // Allow process.env to override (tests + ad-hoc dev).
  for (const k of ['LITELLM_API_KEY', 'LITELLM_MASTER_KEY', 'LITELLM_BASE_URL']) {
    if (process.env[k]) env[k] = process.env[k]!
  }
  const apiKey = env.LITELLM_API_KEY || env.LITELLM_MASTER_KEY
  const apiBase = (env.LITELLM_BASE_URL || 'http://127.0.0.1:4000/v1').replace(/\/$/, '')
  if (!apiKey) {
    throw new CliError('No LITELLM_API_KEY / LITELLM_MASTER_KEY in ~/litellm/.env or env.')
  }
  return { apiBase, apiKey, model: model || 'claude-haiku-4-5' }
}

export const runAgentCommand = defineCommand({
  meta: {
    name: 'run',
    description: 'Execute one task (typically launchd-invoked). Reports the run record to troop.',
  },
  args: {
    'task-id': {
      type: 'positional',
      description: 'Task ID (slug) to run. The cached spec at ~/.openape/agent/tasks/<id>.json is used.',
      required: true,
    },
    'troop-url': {
      type: 'string',
      description: 'Override troop SP base URL.',
    },
    'model': {
      type: 'string',
      description: 'Override the LLM model name. Default: claude-haiku-4-5.',
    },
  },
  async run({ args }) {
    const taskId = args['task-id'] as string
    const auth = readAuth()
    const spec = readTaskSpec(taskId)
    const agentCfg = readAgentConfig()
    const config = readLitellmConfig(args.model as string | undefined)

    let tools: ReturnType<typeof taskTools>
    try { tools = taskTools(spec.tools) }
    catch (err) {
      // Don't even POST a run record — task is structurally broken.
      // Surfaced via launchd's StandardErrorPath log; the next sync
      // pulls a fresh spec which may have the typo fixed.
      throw new CliError(`task ${taskId}: ${(err as Error).message}`)
    }

    const troop = new TroopClient(resolveTroopUrl(args['troop-url'] as string | undefined), auth.access_token)
    const { id: runId } = await troop.startRun(taskId)
    consola.info(`Run ${runId} started for task ${taskId}`)

    try {
      const result = await runLoop({
        config,
        // Agent persona/behaviour ("you are Igor, …") set at agent level;
        // the task's userPrompt is the imperative job ("read my mail and
        // summarise"). The cron firing is the trigger — the message body
        // is the task itself.
        systemPrompt: agentCfg.systemPrompt,
        userMessage: spec.userPrompt,
        tools,
        maxSteps: spec.maxSteps,
      })

      await troop.finaliseRun(runId, {
        status: result.status,
        final_message: result.finalMessage,
        step_count: result.stepCount,
        trace: result.trace,
      })
      consola.success(`Run ${runId} ${result.status} (${result.stepCount} steps)`)
      if (auth.owner_email) {
        await postRunResultToChat({
          authToken: auth.access_token,
          ownerEmail: auth.owner_email,
          taskName: spec.name,
          status: result.status,
          stepCount: result.stepCount,
          finalMessage: result.finalMessage,
        })
      }
      if (result.status === 'error') process.exit(1)
    }
    catch (err) {
      const message = (err as Error)?.message ?? String(err)
      await troop.finaliseRun(runId, {
        status: 'error',
        final_message: message.slice(0, 4000),
        step_count: 0,
        trace: [],
      }).catch(() => { /* best-effort */ })
      if (auth.owner_email) {
        await postRunResultToChat({
          authToken: auth.access_token,
          ownerEmail: auth.owner_email,
          taskName: spec.name,
          status: 'error',
          stepCount: 0,
          finalMessage: message,
        })
      }
      throw new CliError(`Run ${runId} crashed: ${message}`)
    }
  },
})
