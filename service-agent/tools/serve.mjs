#!/usr/bin/env node
// Generic service-agent worker: drain a service provider's A2A task queue.
//
// For each task: GET the next task, ask the LLM to do it, POST the result back —
// looping until --max-runtime, then exiting (the agent's cron schedule re-fires
// this every minute). Dependency-free (Node >= 20 built-ins only).
//
//   Auth:  the agent's DDISA bearer, read from ~/.config/apes/auth.json
//          (the running bridge keeps that token fresh).
//   LLM:   the Nest LLM endpoint from LITELLM_BASE_URL (+ key) in the env.
//
// Usage: node tools/serve.mjs --sp <url> --model <m> --max-runtime 50s

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const sp = arg('sp', '').replace(/\/$/, '')
const model = arg('model', 'gpt-5.5')
const maxRuntimeMs = (Number.parseInt(String(arg('max-runtime', '50')).replace(/s$/, ''), 10) || 50) * 1000
const llmBase = (process.env.LITELLM_BASE_URL || 'http://127.0.0.1:4000/v1').replace(/\/$/, '')
const llmKey = process.env.LITELLM_API_KEY || process.env.LITELLM_MASTER_KEY || 'sk-loopback'

if (!sp) {
  console.error('serve: --sp <url> is required')
  process.exit(1)
}

function bearer() {
  const path = join(homedir(), '.config', 'apes', 'auth.json')
  const { access_token: accessToken } = JSON.parse(readFileSync(path, 'utf8'))
  return `Bearer ${accessToken}`
}

async function nextTask() {
  const res = await fetch(`${sp}/api/agent/tasks/next`, {
    method: 'POST',
    headers: { authorization: bearer(), 'content-type': 'application/json' },
  })
  if (!res.ok)
    throw new Error(`GetNextTask HTTP ${res.status}`)
  return (await res.json()).task ?? null
}

async function resolveTask(id, state, text) {
  const res = await fetch(`${sp}/api/agent/tasks/resolve`, {
    method: 'POST',
    headers: { authorization: bearer(), 'content-type': 'application/json' },
    body: JSON.stringify({
      id,
      state,
      artifact: { artifactId: crypto.randomUUID(), parts: [{ kind: 'text', text }] },
    }),
  })
  if (!res.ok)
    throw new Error(`ResolveTask HTTP ${res.status}`)
}

function taskSpec(task) {
  const data = task.history?.[0]?.parts?.find(p => p.kind === 'data')?.data
  if (!data || typeof data.systemPrompt !== 'string' || typeof data.userMessage !== 'string')
    throw new Error('task payload missing systemPrompt/userMessage')
  return data
}

async function complete(spec) {
  const res = await fetch(`${llmBase}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${llmKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: spec.model || model,
      messages: [
        { role: 'system', content: spec.systemPrompt },
        { role: 'user', content: spec.userMessage },
      ],
    }),
  })
  if (!res.ok)
    throw new Error(`LLM HTTP ${res.status}`)
  return (await res.json()).choices?.[0]?.message?.content ?? ''
}

const deadline = Date.now() + maxRuntimeMs
let fatal = null

while (Date.now() < deadline) {
  let task
  try {
    task = await nextTask()
  }
  catch (err) {
    fatal = err
    break
  }
  if (!task) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    continue
  }
  try {
    await resolveTask(task.id, 'completed', await complete(taskSpec(task)))
  }
  catch (err) {
    await resolveTask(task.id, 'failed', String(err?.message ?? err)).catch(() => {})
  }
}

// Silent on success: an empty poll — the common once-a-minute case — prints
// nothing and exits 0, so the agent's cron runner sends no DM. Only a fatal
// infra error (the SP queue is unreachable) is loud: stderr + non-zero exit,
// so the owner is pinged exactly when the worker itself is broken. Per-task
// outcomes report back to the SP; the run is recorded in troop either way.
if (fatal) {
  console.error(`[serve] ${fatal.message}`)
  process.exitCode = 1
}
