import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { ofetch } from 'ofetch'
import { getAuthorizedBearer } from './bearer.js'

// ---------------------------------------------------------------------------
// ApiError — exported so CLIs can catch + display it in their error handler
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public status: number,
    public title: string,
    public detail?: string,
  ) {
    super(detail ? `${title}: ${detail}` : title)
    this.name = 'ApiError'
  }
}

// ---------------------------------------------------------------------------
// createSpClient — factory for SP CLIs
// ---------------------------------------------------------------------------

export interface SpClientOptions {
  /** Fallback endpoint when neither env var nor stored session has one. */
  defaultEndpoint: string
  /** Environment variable name for endpoint override (e.g. `APE_CHAT_ENDPOINT`). */
  envVar: string
  /** Config filename written to `~/.openape/<configFile>` (e.g. `auth-chat.json`). */
  configFile: string
  /**
   * SP audience used for token exchange (e.g. `chat.openape.ai`).
   * Passed to `getAuthorizedBearer({ aud })`.
   */
  defaultAud: string
}

/** Generic per-CLI state persisted to `~/.openape/<configFile>`. */
export interface SpClientState {
  endpoint?: string
  [key: string]: unknown
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | undefined>
  endpoint?: string
}

export interface SpClient<TState extends SpClientState = SpClientState> {
  /** Resolved path to the config file. */
  configPath: string

  /** Endpoint resolution: explicit arg > env var > stored session > default. */
  resolveEndpoint: (override?: string | null) => string

  /** Load the full state object from disk (returns `{}` when absent). */
  loadConfig: () => TState

  /** Merge-write state to disk (mode 0o600). */
  saveConfig: (next: TState) => void

  /**
   * Generic HTTP helper — constructs the URL from endpoint + path, injects
   * the Authorization header via `getAuthorizedBearer`, and maps non-2xx
   * responses to `ApiError`.
   */
  apiCall: <T>(path: string, opts?: RequestOptions) => Promise<T>

  /**
   * Expose the raw request fn under a stable alias so callers can use it for
   * ad-hoc paths without a typed wrapper (mirrors the `_request` export in
   * chat-cli's legacy api.ts).
   */
  _request: <T>(path: string, opts?: RequestOptions) => Promise<T>
}

export function createSpClient<TState extends SpClientState = SpClientState>(
  opts: SpClientOptions,
): SpClient<TState> {
  const { defaultEndpoint, envVar, configFile, defaultAud } = opts

  // ---------- config path ---------------------------------------------------

  const configPath = join(homedir(), '.openape', configFile)

  // ---------- state helpers -------------------------------------------------

  function loadConfig(): TState {
    if (!existsSync(configPath)) return {} as TState
    try {
      return JSON.parse(readFileSync(configPath, 'utf8')) as TState
    }
    catch {
      return {} as TState
    }
  }

  function saveConfig(next: TState): void {
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, JSON.stringify(next, null, 2), { mode: 0o600 })
  }

  // ---------- endpoint resolution -------------------------------------------

  function resolveEndpoint(override?: string | null): string {
    if (override) return override.replace(/\/$/, '')
    const env = process.env[envVar]
    if (env) return env.replace(/\/$/, '')
    const stored = loadConfig().endpoint
    if (stored) return (stored as string).replace(/\/$/, '')
    return defaultEndpoint
  }

  // ---------- HTTP layer ----------------------------------------------------

  async function apiCall<T>(path: string, reqOpts: RequestOptions = {}): Promise<T> {
    const endpoint = resolveEndpoint(reqOpts.endpoint)
    const url = `${endpoint}${path}`
    const bearer = await getAuthorizedBearer({ endpoint: resolveEndpoint(), aud: defaultAud })
    const headers: Record<string, string> = { Authorization: bearer }
    try {
      return await ofetch<T>(url, {
        method: reqOpts.method ?? 'GET',
        headers,
        body: reqOpts.body as Record<string, unknown> | undefined,
        query: reqOpts.query as Record<string, string | number> | undefined,
      })
    }
    catch (err: unknown) {
      const status = (err as { status?: number, statusCode?: number }).status
        ?? (err as { statusCode?: number }).statusCode
        ?? 0
      const data = (err as { data?: { title?: string, statusMessage?: string, detail?: string, message?: string } }).data
      const title = data?.title ?? data?.statusMessage ?? data?.message ?? `Request failed (HTTP ${status})`
      throw new ApiError(status, title, data?.detail)
    }
  }

  return {
    configPath,
    resolveEndpoint,
    loadConfig,
    saveConfig,
    apiCall,
    _request: apiCall,
  }
}
