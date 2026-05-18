import { ensureFreshIdpAuth } from '@openape/cli-auth'
import { defineCommand } from 'citty'
import consola from 'consola'
import { CliError } from '../../errors'
import { resolveTroopUrl } from '../../lib/troop-client'

// `apes agent deploy <repo>@<ref> [--param k=v] [--secret ENV=val]`
// — one-step Agent Recipe deploy. Calls troop's recipe-deploy endpoint
// (M3), then binds the declared capability secrets (M2c). The owner's
// IdP token (apes login) authenticates; troop enforces requireOwner.
// See plans.openape.ai 01KRTAE8 (M4).

/** Parse repeatable `KEY=value` flags into a record. Last wins. */
export function parseKeyValues(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of pairs) {
    const eq = p.indexOf('=')
    if (eq <= 0) throw new CliError(`bad key=value pair: "${p}" (expected KEY=value)`)
    out[p.slice(0, eq)] = p.slice(eq + 1)
  }
  return out
}

/** Capability envs the recipe needs that the caller hasn't supplied. */
export function missingCapabilities(required: string[], provided: Record<string, string>): string[] {
  return required.filter(env => !(env in provided))
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[]
  if (typeof v === 'string' && v.length > 0) return [v]
  return []
}

interface DeployResponse {
  intent_id: string
  agent_name: string
  ref: string
  required_capabilities: string[]
  schedules: Array<{ task_id: string, cron: string, name: string }>
}

async function api<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new CliError(`${init?.method ?? 'GET'} ${url} → HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`)
  }
  return res.json() as Promise<T>
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export const deployAgentCommand = defineCommand({
  meta: { name: 'deploy', description: 'Deploy an Agent Recipe (<repo>@<ref>) in one step' },
  args: {
    repo: { type: 'positional', description: 'Recipe repo + pinned ref, e.g. github.com/owner/name@v1.0.0' },
    param: { type: 'string', description: 'Recipe param, KEY=value (repeatable)' },
    secret: { type: 'string', description: 'Capability secret, ENV=value (repeatable; else prompted)' },
    'host-id': { type: 'string', description: 'Target nest host_id (default: first connected)' },
    json: { type: 'boolean', description: 'Machine-readable output, no prompts' },
  },
  async run({ args }) {
    const repoRef = args.repo as string
    if (!repoRef) throw new CliError('usage: apes agent deploy <repo>@<ref> [--param k=v] [--secret ENV=val]')
    const params = parseKeyValues(asArray(args.param))
    const secrets = parseKeyValues(asArray(args.secret))
    const json = !!args.json

    const token = (await ensureFreshIdpAuth()).access_token
    const troop = resolveTroopUrl()

    const deploy = await api<DeployResponse>(`${troop}/api/agents/recipe-deploy`, token, {
      method: 'POST',
      body: JSON.stringify({
        repo_ref: repoRef,
        params,
        ...(args['host-id'] ? { host_id: args['host-id'] as string } : {}),
      }),
    })

    if (!json) {
      consola.success(`Deploying ${deploy.agent_name} from ${repoRef} (ref ${deploy.ref})`)
      consola.info(`Schedules: ${deploy.schedules.map(s => `${s.task_id}=${s.cron}`).join(', ') || 'none'}`)
    }

    // Collect capability values: --secret flags first, then prompt for
    // the rest (unless --json, where missing is a hard error).
    const missing = missingCapabilities(deploy.required_capabilities, secrets)
    if (missing.length > 0) {
      if (json) {
        throw new CliError(`missing required capability secrets: ${missing.join(', ')} (pass via --secret in --json mode)`)
      }
      for (const env of missing) {
        const val = await consola.prompt(`Secret value for ${env}:`, { type: 'text' })
        if (typeof val !== 'string' || val.length === 0) throw new CliError(`no value provided for ${env} — aborting`)
        secrets[env] = val
      }
    }

    // Wait for the agent to come online (spawn-result), then bind the
    // sealed secrets. Binding 409s until the agent's first sync reports
    // its X25519 pubkey, so we retry with backoff.
    if (deploy.required_capabilities.length > 0) {
      if (!json) consola.start('Waiting for the agent to come online…')
      let online = false
      for (let i = 0; i < 90 && !online; i++) {
        const st = await api<{ pending: boolean, ok?: boolean, error?: string }>(
          `${troop}/api/agents/spawn-intent/${deploy.intent_id}`, token,
        )
        if (!st.pending) {
          if (!st.ok) throw new CliError(`spawn failed: ${st.error ?? 'unknown error'}`)
          online = true
          break
        }
        await sleep(2000)
      }
      if (!online) throw new CliError('timed out waiting for the agent to spawn — bind secrets later with `apes agent secret`')

      for (const [env, value] of Object.entries(secrets)) {
        let bound = false
        for (let i = 0; i < 60 && !bound; i++) {
          try {
            await api(`${troop}/api/agents/${deploy.agent_name}/secrets/${env}`, token, {
              method: 'PUT',
              body: JSON.stringify({ value }),
            })
            bound = true
          }
          catch (e) {
            // 404 (agent row not synced yet) / 409 (no pubkey yet) → retry.
            if (i === 59) throw e
            await sleep(3000)
          }
        }
        if (!json) consola.success(`Bound ${env}`)
      }
    }

    if (json) {
      consola.log(JSON.stringify({
        ok: true,
        agent_name: deploy.agent_name,
        ref: deploy.ref,
        intent_id: deploy.intent_id,
        schedules: deploy.schedules,
        bound: Object.keys(secrets),
      }))
    }
    else {
      consola.success(`${deploy.agent_name} deployed. Schedules are live; secrets sealed to the agent.`)
    }
  },
})
