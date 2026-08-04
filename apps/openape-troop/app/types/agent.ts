// Shapes returned by /api/agents/[name] and /api/nest/hosts. Shared by the
// agent detail page and the cards it composes.

export interface Agent {
  email: string
  ownerEmail: string
  agentName: string
  hostId: string | null
  hostname: string | null
  pubkeySsh: string | null
  systemPrompt: string
  /**
   * Tool-name whitelist — drives which tools the chat-bridge exposes to the
   * LLM during live thread turns. Defaults to all known tools on first sync;
   * owner narrows here.
   */
  tools: string[]
  paused: boolean
  firstSeenAt: number | null
  lastSeenAt: number | null
  createdAt: number
}

export interface Task {
  agentEmail: string
  taskId: string
  name: string
  cron: string
  userPrompt: string
  tools: string[]
  maxSteps: number
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface Run {
  id: string
  agentEmail: string
  taskId: string
  startedAt: number
  finishedAt: number | null
  status: 'running' | 'ok' | 'error'
  finalMessage: string | null
  stepCount: number | null
  trace: unknown
}

export interface Detail {
  agent: Agent
  tasks: Task[]
  recentRuns: Run[]
}

export interface NestHost {
  host_id: string
  hostname: string
  version: string
  last_seen_at: number
}
