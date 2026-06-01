import { getAuthorizedBearer, NotLoggedInError } from '@openape/cli-auth'
import { CliError } from './errors'

// Thin owner-side client for troop.openape.ai. Every request carries an
// SP-scoped Bearer minted from the shared `apes login` session via
// @openape/cli-auth (RFC 8693 token-exchange, cached under
// ~/.config/apes/sp-tokens/). No per-CLI login — `ape-troop login` is a
// stub that points at `apes login` (see commands/auth.ts).
//
// First-party owner tokens are unbounded server-side, so we don't request
// specific scopes here; troop's requireOwnerWithScope auto-passes them.

const DEFAULT_TROOP_URL = 'https://troop.openape.ai'

export function resolveTroopUrl(override?: string): string {
  const raw = override || process.env.OPENAPE_TROOP_URL || DEFAULT_TROOP_URL
  return raw.replace(/\/$/, '')
}

export interface NestRow {
  host_id: string
  display_name: string
  pod_uuid: string | null
  status: 'active' | 'revoked'
  created_at: number
  last_seen_at: number | null
}

export interface BindResult {
  host_id: string
  display_name: string
  reused: boolean
}

export interface AgentRow {
  email: string
  agentName: string
  hostId: string | null
  hostname: string | null
  lastSeenAt: number | null
  createdAt: number
  taskCount: number
  lastRunStatus: string | null
  lastRunAt: number | null
}

export interface IntentResult {
  intent_id: string
  host_id: string
  hostname: string
}

export interface SpawnPoll {
  pending: boolean
  ok?: boolean
  agent_email?: string
  error?: string
}

export interface DestroyPoll {
  pending: boolean
  ok?: boolean
  error?: string
}

export class TroopApi {
  readonly url: string
  readonly aud: string

  constructor(troopUrl?: string) {
    this.url = resolveTroopUrl(troopUrl)
    this.aud = new URL(this.url).host
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let bearer: string
    try {
      bearer = await getAuthorizedBearer({ endpoint: this.url, aud: this.aud })
    }
    catch (err) {
      if (err instanceof NotLoggedInError) {
        throw new CliError('Not authenticated. Run `apes login <email>` first.')
      }
      throw err
    }

    const res = await fetch(`${this.url}${path}`, {
      ...init,
      headers: {
        'Authorization': bearer,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new CliError(`troop ${init?.method ?? 'GET'} ${path} failed: ${res.status} ${text}`)
    }
    if (res.status === 204) return undefined as T
    return await res.json() as T
  }

  listNests(): Promise<NestRow[]> {
    return this.request('/api/nests')
  }

  bindNest(displayName: string, podUuid?: string): Promise<BindResult> {
    return this.request('/api/nests/bind', {
      method: 'POST',
      body: JSON.stringify({ display_name: displayName, ...(podUuid ? { pod_uuid: podUuid } : {}) }),
    })
  }

  removeNest(hostId: string): Promise<{ host_id: string, status: string }> {
    return this.request(`/api/nests/${encodeURIComponent(hostId)}`, { method: 'DELETE' })
  }

  listAgents(): Promise<AgentRow[]> {
    return this.request('/api/agents')
  }

  spawnAgent(input: { name: string, hostId?: string, systemPrompt?: string }): Promise<IntentResult> {
    return this.request('/api/agents/spawn-intent', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        ...(input.hostId ? { host_id: input.hostId } : {}),
        ...(input.systemPrompt ? { system_prompt: input.systemPrompt } : {}),
      }),
    })
  }

  pollSpawn(intentId: string): Promise<SpawnPoll> {
    return this.request(`/api/agents/spawn-intent/${encodeURIComponent(intentId)}`)
  }

  destroyAgent(input: { name: string, hostId?: string }): Promise<IntentResult> {
    return this.request('/api/agents/destroy-intent', {
      method: 'POST',
      body: JSON.stringify({ name: input.name, ...(input.hostId ? { host_id: input.hostId } : {}) }),
    })
  }

  pollDestroy(intentId: string): Promise<DestroyPoll> {
    return this.request(`/api/agents/destroy-intent/${encodeURIComponent(intentId)}`)
  }
}
