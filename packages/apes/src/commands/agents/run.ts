import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineCommand } from 'citty'
import consola from 'consola'
import { CliError } from '../../errors'
import { taskTools } from '../../lib/agent-tools'
import { runLoop  } from '../../lib/agent-runtime'
import type { RuntimeConfig } from '../../lib/agent-runtime'
import { resolveTribeUrl, TribeClient  } from '../../lib/tribe-client'
import type { TaskSpec } from '../../lib/tribe-client'

const AUTH_PATH = join(homedir(), '.config', 'apes', 'auth.json')
const TASK_CACHE_DIR = join(homedir(), '.openape', 'agent', 'tasks')

interface AuthJson { access_token: string, email: string }

function readAuth(): AuthJson {
  if (!existsSync(AUTH_PATH)) {
    throw new CliError(`No agent auth found at ${AUTH_PATH}. Run \`apes agents spawn <name>\` first.`)
  }
  const parsed = JSON.parse(readFileSync(AUTH_PATH, 'utf8')) as AuthJson
  if (!parsed.access_token) throw new CliError('auth.json missing access_token')
  return parsed
}

function readTaskSpec(taskId: string): TaskSpec {
  const path = join(TASK_CACHE_DIR, `${taskId}.json`)
  if (!existsSync(path)) {
    throw new CliError(`No cached task spec at ${path}. Run \`apes agents sync\` first to pull the task list from tribe.`)
  }
  return JSON.parse(readFileSync(path, 'utf8')) as TaskSpec
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
    description: 'Execute one task (typically launchd-invoked). Reports the run record to tribe.',
  },
  args: {
    'task-id': {
      type: 'positional',
      description: 'Task ID (slug) to run. The cached spec at ~/.openape/agent/tasks/<id>.json is used.',
      required: true,
    },
    'tribe-url': {
      type: 'string',
      description: 'Override tribe SP base URL.',
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
    const config = readLitellmConfig(args.model as string | undefined)

    let tools: ReturnType<typeof taskTools>
    try { tools = taskTools(spec.tools) }
    catch (err) {
      // Don't even POST a run record — task is structurally broken.
      // Surfaced via launchd's StandardErrorPath log; the next sync
      // pulls a fresh spec which may have the typo fixed.
      throw new CliError(`task ${taskId}: ${(err as Error).message}`)
    }

    const tribe = new TribeClient(resolveTribeUrl(args['tribe-url'] as string | undefined), auth.access_token)
    const { id: runId } = await tribe.startRun(taskId)
    consola.info(`Run ${runId} started for task ${taskId}`)

    try {
      const result = await runLoop({
        config,
        systemPrompt: spec.systemPrompt,
        // Cron tasks have no prior user message — the task fires by
        // schedule. We use a synthetic kick-off message; tasks can
        // ignore it via their system prompt.
        userMessage: 'It is time to run this task. Use your tools as needed and report when done.',
        tools,
        maxSteps: spec.maxSteps,
      })

      await tribe.finaliseRun(runId, {
        status: result.status,
        final_message: result.finalMessage,
        step_count: result.stepCount,
        trace: result.trace,
      })
      consola.success(`Run ${runId} ${result.status} (${result.stepCount} steps)`)
      if (result.status === 'error') process.exit(1)
    }
    catch (err) {
      const message = (err as Error)?.message ?? String(err)
      await tribe.finaliseRun(runId, {
        status: 'error',
        final_message: message.slice(0, 4000),
        step_count: 0,
        trace: [],
      }).catch(() => { /* best-effort */ })
      throw new CliError(`Run ${runId} crashed: ${message}`)
    }
  },
})
