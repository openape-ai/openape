// ape-agent-service: a *service-agent* worker.
//
// Symmetric to bridge.ts (chat), but the work source is an SP backend instead
// of troop-chat. The worker connects to ONE SP, pulls a task (GetNextTask),
// runs it through the same `runLoop` (the Nest LLM + tools), and posts the
// result back (ResolveTask). Because it *pulls*, it runs anywhere that can
// reach the SP's routes — co-located on chatty or on a laptop behind NAT.
//
// Task contract (SP-owned): the task's first history message carries a `data`
// part = { systemPrompt, userMessage, tools?, model?, maxSteps? } — a runLoop
// spec. The worker is generic: it executes whatever spec the SP enqueues.
//
// Env knobs:
//   OPENAPE_SP_BASE_URL    the SP this agent serves (GetNextTask/ResolveTask) — REQUIRED
//   LITELLM_BASE_URL       the LLM endpoint. A llms.openape.ai gateway makes
//                          the agent exchange its own DDISA token per task;
//                          any other base uses LITELLM_API_KEY as-is.
//   LITELLM_API_KEY        LLM key — REQUIRED. Used
//                          directly for non-gateway bases, and as the fallback
//                          if a gateway token exchange fails.
//   APE_SERVICE_MODEL      model, e.g. gpt-5.5 — REQUIRED
//   APE_SERVICE_POLL_MS    idle poll interval (default 2000)
//   APE_SERVICE_MAX_STEPS  runLoop max tool rounds (default 10)

import { randomUUID } from 'node:crypto'
import process from 'node:process'
import type { RuntimeConfig } from '@openape/apes'
import { runLoop, taskTools } from '@openape/apes'
import { ensureFreshIdpAuth } from '@openape/cli-auth'
import type { Artifact, Part, Task, TaskState } from '@openape/sp-tasks'
import { readAgentIdentity } from './identity'
import { resolveLlmGatewayKey } from './llm-gateway-key'

export interface WorkerDeps {
  /** Base URL of the SP backend (no trailing slash). */
  spBaseUrl: string
  /** Resolve the `Authorization` header value (the agent's DDISA bearer). */
  bearer: () => Promise<string>
  fetchImpl: typeof fetch
  runLoopImpl: typeof runLoop
  config: RuntimeConfig
  /**
   * Re-mint the LLM key just before a task runs. When the gateway is
   * llms.openape.ai this returns the agent's own DDISA token; unset → the
   * static `config.apiKey` is used as-is (loopback proxy / tests).
   */
  refreshApiKey?: () => Promise<string>
  maxSteps: number
  log: (line: string) => void
}

interface TaskSpec {
  systemPrompt: string
  userMessage: string
  tools?: string[]
  model?: string
  maxSteps?: number
}

function textArtifact(text: string): Artifact {
  return { artifactId: randomUUID(), parts: [{ kind: 'text', text }] }
}

function parseTaskSpec(task: Task): TaskSpec {
  const dataPart = task.history[0]?.parts.find((p): p is Extract<Part, { kind: 'data' }> => p.kind === 'data')
  const data = dataPart?.data as Partial<TaskSpec> | undefined
  if (!data || typeof data.systemPrompt !== 'string' || typeof data.userMessage !== 'string')
    throw new Error('task payload missing systemPrompt/userMessage')
  return {
    systemPrompt: data.systemPrompt,
    userMessage: data.userMessage,
    tools: Array.isArray(data.tools) ? data.tools.filter((t): t is string => typeof t === 'string') : undefined,
    model: typeof data.model === 'string' ? data.model : undefined,
    maxSteps: typeof data.maxSteps === 'number' ? data.maxSteps : undefined,
  }
}

async function getNextTask(deps: WorkerDeps): Promise<Task | null> {
  const res = await deps.fetchImpl(`${deps.spBaseUrl}/api/agent/tasks/next`, {
    method: 'POST',
    headers: { 'authorization': await deps.bearer(), 'content-type': 'application/json' },
  })
  if (!res.ok)
    throw new Error(`GetNextTask HTTP ${res.status}`)
  const body = await res.json() as { task: Task | null }
  return body.task ?? null
}

async function resolveTask(deps: WorkerDeps, id: string, state: TaskState, artifact: Artifact): Promise<void> {
  const res = await deps.fetchImpl(`${deps.spBaseUrl}/api/agent/tasks/resolve`, {
    method: 'POST',
    headers: { 'authorization': await deps.bearer(), 'content-type': 'application/json' },
    body: JSON.stringify({ id, state, artifact }),
  })
  if (!res.ok)
    throw new Error(`ResolveTask HTTP ${res.status}`)
}

/**
 * Claim one task and process it, returning `'task'` if it ran one or `'idle'`
 * if the queue was empty. Processing errors (bad payload, runLoop throw/error)
 * are turned into a terminal `failed` resolve — the worker never crashes on a
 * single bad task. The terminal state is computed first and posted once.
 */
export async function pollOnce(deps: WorkerDeps): Promise<'task' | 'idle'> {
  const task = await getNextTask(deps)
  if (!task)
    return 'idle'

  let state: TaskState
  let artifact: Artifact
  try {
    const spec = parseTaskSpec(task)
    const apiKey = deps.refreshApiKey ? await deps.refreshApiKey() : deps.config.apiKey
    const config = { ...deps.config, apiKey, ...(spec.model ? { model: spec.model } : {}) }
    const result = await deps.runLoopImpl({
      config,
      userMessage: spec.userMessage,
      systemPrompt: spec.systemPrompt,
      tools: taskTools(spec.tools ?? []),
      maxSteps: spec.maxSteps ?? deps.maxSteps,
    })
    if (result.status === 'error')
      throw new Error(result.finalMessage ?? 'runLoop returned status error')
    state = 'completed'
    artifact = textArtifact(result.finalMessage ?? '')
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    deps.log(`task ${task.id} failed: ${msg}`)
    state = 'failed'
    artifact = textArtifact(msg)
  }

  await resolveTask(deps, task.id, state, artifact)
  return 'task'
}

interface ServiceConfig {
  spBaseUrl: string
  apiBase: string
  apiKey: string
  model: string
  pollIntervalMs: number
  maxSteps: number
}

function readServiceConfig(): ServiceConfig {
  const spBaseUrl = process.env.OPENAPE_SP_BASE_URL?.replace(/\/$/, '')
  if (!spBaseUrl)
    throw new Error('OPENAPE_SP_BASE_URL is not set — the SP backend this service-agent serves.')
  const apiKey = process.env.LITELLM_API_KEY
  if (!apiKey)
    throw new Error('LITELLM_API_KEY must be set.')
  const model = process.env.APE_SERVICE_MODEL
  if (!model)
    throw new Error('APE_SERVICE_MODEL is not set (e.g. gpt-5.5).')
  const poll = process.env.APE_SERVICE_POLL_MS ? Number.parseInt(process.env.APE_SERVICE_POLL_MS, 10) : 2000
  const steps = process.env.APE_SERVICE_MAX_STEPS ? Number.parseInt(process.env.APE_SERVICE_MAX_STEPS, 10) : 10
  return {
    spBaseUrl,
    apiBase: (process.env.LITELLM_BASE_URL ?? 'http://127.0.0.1:4001/v1').replace(/\/$/, ''),
    apiKey,
    model,
    pollIntervalMs: Number.isFinite(poll) && poll > 0 ? poll : 2000,
    maxSteps: Number.isFinite(steps) && steps > 0 ? steps : 10,
  }
}

function log(line: string): void {
  process.stderr.write(`${new Date().toISOString()}  [service] ${line}\n`)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Boot the worker from env + identity and poll forever. */
export async function runService(): Promise<void> {
  const cfg = readServiceConfig()
  const id = readAgentIdentity()
  const deps: WorkerDeps = {
    spBaseUrl: cfg.spBaseUrl,
    bearer: async () => `Bearer ${(await ensureFreshIdpAuth()).access_token}`,
    fetchImpl: fetch,
    runLoopImpl: runLoop,
    config: { apiBase: cfg.apiBase, apiKey: cfg.apiKey, model: cfg.model },
    refreshApiKey: () => resolveLlmGatewayKey(cfg.apiBase, cfg.apiKey, log),
    maxSteps: cfg.maxSteps,
    log,
  }
  log(`service-agent ${id.email} → SP ${cfg.spBaseUrl}, LLM ${cfg.apiBase}, model ${cfg.model}, poll ${cfg.pollIntervalMs}ms`)
  for (;;) {
    try {
      if (await pollOnce(deps) === 'idle')
        await sleep(cfg.pollIntervalMs)
    }
    catch (err) {
      log(`poll error: ${err instanceof Error ? err.message : String(err)}`)
      await sleep(cfg.pollIntervalMs)
    }
  }
}
