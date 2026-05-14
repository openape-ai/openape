// Typed thin client for troop.openape.ai's agent-side API. The CLI
// never talks to the owner-side endpoints (those are for the web UI);
// the troop-client only knows about the three /me/* endpoints needed
// by `apes agents sync` and `apes agents run`.
//
// Default endpoint is https://troop.openape.ai. Override with the
// OPENAPE_TROOP_URL env var (handy for staging or local dev). The
// agent JWT comes from `~/.config/apes/auth.json` — the file
// `apes agents spawn` writes when it provisions the macOS user.

export const DEFAULT_TROOP_URL = 'https://troop.openape.ai'

export interface TaskSpec {
  agentEmail: string
  taskId: string
  name: string
  cron: string
  /**
   * Imperative job description — sent as the LLM `user` message at run
   * time. The agent's persona / behaviour rules are in `agent.systemPrompt`
   * and served separately at sync time (see `AgentTasksResponse`).
   */
  userPrompt: string
  tools: string[]
  maxSteps: number
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface SkillSpec {
  /** Slug — becomes the directory name on disk (`skills/<name>/SKILL.md`). */
  name: string
  /** One-line summary the LLM sees in the system prompt's available_skills block. */
  description: string
  /** Full SKILL.md content the agent runtime writes to disk after sync. */
  body: string
}

/** Response from /api/agents/me/tasks — agent config + task list. */
export interface AgentTasksResponse {
  /**
   * Agent-level persona/behaviour rules — used as `system` for both
   * cron task runs and live chat-bridge messages. Empty string when the
   * owner hasn't set one.
   */
  system_prompt: string
  /**
   * Tool whitelist for chat-bridge runtime. Cron tasks have their own
   * per-task `tools[]` (see TaskSpec); this is the list the bridge
   * exposes to the LLM during live chat-thread turns. Empty array =
   * no tools (pure chat). Defaults to "all known tools" on first
   * sync — owner narrows via troop UI.
   */
  tools: string[]
  /**
   * Lazy-load skill catalog — only enabled rows from agent_skills.
   * Each one lands at `~/.openape/agent/skills/<name>/SKILL.md`.
   */
  skills: SkillSpec[]
  tasks: TaskSpec[]
}

export interface SyncResponse {
  agent_email: string
  host_id: string
  first_sync: boolean
  last_seen_at: number
}

export interface RunStartResponse {
  id: string
  started_at: number
}

export interface RunFinalisePayload {
  status: 'ok' | 'error'
  final_message: string | null
  step_count: number
  trace?: unknown
}

export class TroopClient {
  constructor(
    public readonly troopUrl: string,
    public readonly agentJwt: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.troopUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        'Authorization': `Bearer ${this.agentJwt}`,
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`troop ${init?.method ?? 'GET'} ${path} failed: ${res.status} ${text}`)
    }
    if (res.status === 204) return undefined as T
    return await res.json() as T
  }

  sync(input: { hostname: string, hostId: string, ownerEmail: string, pubkeySsh?: string }): Promise<SyncResponse> {
    return this.request('/api/agents/me/sync', {
      method: 'POST',
      body: JSON.stringify({
        hostname: input.hostname,
        host_id: input.hostId,
        owner_email: input.ownerEmail,
        ...(input.pubkeySsh ? { pubkey_ssh: input.pubkeySsh } : {}),
      }),
    })
  }

  listTasks(): Promise<AgentTasksResponse> {
    return this.request('/api/agents/me/tasks')
  }

  startRun(taskId: string): Promise<RunStartResponse> {
    return this.request('/api/agents/me/runs', {
      method: 'POST',
      body: JSON.stringify({ task_id: taskId }),
    })
  }

  finaliseRun(id: string, payload: RunFinalisePayload): Promise<unknown> {
    return this.request(`/api/agents/me/runs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  }
}

export function resolveTroopUrl(override?: string): string {
  if (override) return override.replace(/\/$/, '')
  const fromEnv = process.env.OPENAPE_TROOP_URL
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  return DEFAULT_TROOP_URL
}
