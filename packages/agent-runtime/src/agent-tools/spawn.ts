import type { ToolDefinition } from './index'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// `agent.spawn` — lets an orchestrator agent (the PM) spawn a worker agent on
// the nest via troop, choosing the worker's model AND reasoning depth by task
// difficulty. This is the DDISA path (same as the Owner UI's spawn-member):
// read this agent's IdP token, exchange it for a `troop:spawn-agent`-scoped
// bearer, then POST the spawn-intent. The plain `http.*` tools can't do this —
// they forbid the Authorization header on purpose; this tool handles the bearer
// itself. The spawning agent must hold the `troop:spawn-agent` scope in its
// delegation, or the exchange is rejected (returned as a clear tool error).

function troopBase(): string {
  return (process.env.OPENAPE_TROOP_URL ?? 'https://troop.openape.ai').replace(/\/+$/, '')
}

function readAgentToken(): string {
  const path = process.env.OPENAPE_CLI_AUTH_HOME
    ? join(process.env.OPENAPE_CLI_AUTH_HOME, 'auth.json')
    : join(homedir(), '.config', 'apes', 'auth.json')
  const auth = JSON.parse(readFileSync(path, 'utf8')) as { access_token?: string }
  if (!auth.access_token) throw new Error(`no access_token in ${path}`)
  return auth.access_token
}

export const spawnTools: ToolDefinition[] = [
  {
    name: 'agent.spawn',
    description:
      'Spawn a worker agent on the nest via troop, tiering its compute by task '
      + 'difficulty: pick `model` (gpt-5.4-mini | gpt-5.4 | gpt-5.5) and '
      + '`reasoning_effort` (minimal | low | medium | high) — quick-win = cheap+low, '
      + 'research/architecture = gpt-5.5+high. Optionally attach a `recipe_ref` so the '
      + 'worker runs a known persona. Returns the spawn intent id. Use multiple calls to '
      + 'fan out several workers in parallel.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'unique worker name, /^[a-z][a-z0-9-]{0,23}$/' },
        model: { type: 'string', description: 'gpt-5.4-mini | gpt-5.4 | gpt-5.5' },
        reasoning_effort: { type: 'string', description: 'minimal | low | medium | high' },
        recipe_ref: { type: 'string', description: 'optional recipe, e.g. github.com/openape-ai/agent-catalog/backend-engineer@v0.2.0' },
        system_prompt: { type: 'string', description: 'optional system prompt / task brief' },
      },
      required: ['name'],
    },
    execute: async (args) => {
      const a = args as {
        name: string
        model?: string
        reasoning_effort?: string
        recipe_ref?: string
        system_prompt?: string
      }
      const base = troopBase()
      let token: string
      try {
        token = readAgentToken()
      }
      catch (err) {
        return `spawn failed: ${err instanceof Error ? err.message : String(err)}`
      }

      const exRes = await fetch(`${base}/api/cli/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject_token: token, scopes: ['troop:spawn-agent'] }),
      })
      if (!exRes.ok) {
        return `spawn failed: token exchange ${exRes.status} — ${(await exRes.text().catch(() => '')).slice(0, 200)} `
          + '(does this agent hold the troop:spawn-agent scope?)'
      }
      const ex = await exRes.json() as { access_token: string }

      const body: Record<string, unknown> = { name: a.name }
      if (a.model) body.bridge_model = a.model
      if (a.reasoning_effort) body.bridge_reasoning_effort = a.reasoning_effort
      if (a.system_prompt) body.system_prompt = a.system_prompt
      if (a.recipe_ref) body.recipe = { repo_ref: a.recipe_ref, params: {} }

      const spRes = await fetch(`${base}/api/agents/spawn-intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${ex.access_token}` },
        body: JSON.stringify(body),
      })
      if (!spRes.ok) {
        return `spawn failed: spawn-intent ${spRes.status} — ${(await spRes.text().catch(() => '')).slice(0, 200)}`
      }
      const sp = await spRes.json() as { intent_id?: string }
      return `spawned worker "${a.name}" (model=${a.model ?? 'default'}, reasoning=${a.reasoning_effort ?? 'default'}); intent=${sp.intent_id ?? '?'}`
    },
  },
]
