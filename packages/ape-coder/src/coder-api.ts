import { getAuthorizedBearer, NotLoggedInError } from '@openape/cli-auth'
import { CliError } from './errors'

// Thin client for coder.openape.ai. Every request carries an SP-scoped Bearer
// minted from the shared `apes login` session via @openape/cli-auth (RFC 8693
// token-exchange, cached under ~/.config/apes/sp-tokens/). No per-CLI login —
// `ape-coder login` is a stub that points at `apes login` (commands/auth.ts).
//
// The CLI holds NO authority of its own: it hits the same API endpoints the web
// UI uses, which enforce the same permission model. Whatever the server forbids
// (member without a write grant, agent token trying to invite, …) comes back as
// an error and is surfaced verbatim — the CLI never works around it.

const DEFAULT_CODER_URL = 'https://coder.openape.ai'

export function resolveCoderUrl(override?: string): string {
  const raw = override || process.env.OPENAPE_CODER_URL || DEFAULT_CODER_URL
  return raw.replace(/\/$/, '')
}

export interface Project {
  id: string
  name: string
  visionMd: string
  repos: string[]
  createdAt: number
  updatedAt: number
}

export type StoryStatus = 'draft' | 'consistent' | 'approved' | 'red' | 'green' | 'documented'

export interface Story {
  id: string
  projectId: string
  title: string
  storySentence: string
  acceptanceCriteria: string
  repos: string[]
  links: string[]
  testReferences: string[]
  status: StoryStatus
  createdAt: number
  updatedAt: number
}

export type StoryPatch = Partial<Pick<Story,
  'title' | 'storySentence' | 'acceptanceCriteria' | 'repos' | 'links' | 'testReferences'
>>

/**
 * Problem details surfaced by the API; carries the server's HTTP status so the
 * caller can tell "forbidden" (permission) from "not found" / "unauthenticated".
 */
export class ApiError extends CliError {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export class CoderApi {
  readonly url: string
  readonly aud: string

  constructor(coderUrl?: string) {
    this.url = resolveCoderUrl(coderUrl)
    this.aud = new URL(this.url).host
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let bearer: string
    try {
      bearer = await getAuthorizedBearer({ endpoint: this.url, aud: this.aud })
    }
    catch (err) {
      if (err instanceof NotLoggedInError) {
        throw new CliError('Not signed in. Run `apes login <email>` once on this device — ape-coder reuses that session.')
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
      const message = await this.readErrorMessage(res)
      throw new ApiError(res.status, message)
    }
    if (res.status === 204) return undefined as T
    return await res.json() as T
  }

  private async readErrorMessage(res: Response): Promise<string> {
    const text = await res.text().catch(() => '')
    if (!text) return `${res.status} ${res.statusText}`
    try {
      const body = JSON.parse(text) as { message?: string, statusMessage?: string }
      return body.message || body.statusMessage || text
    }
    catch {
      return text
    }
  }

  listProjects(): Promise<Project[]> {
    return this.request('/api/projects')
  }

  getProject(projectId: string): Promise<Project> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}`)
  }

  listStories(projectId: string): Promise<Story[]> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/stories`)
  }

  getStory(projectId: string, storyId: string): Promise<Story> {
    return this.request(
      `/api/projects/${encodeURIComponent(projectId)}/stories/${encodeURIComponent(storyId)}`,
    )
  }

  updateStory(projectId: string, storyId: string, patch: StoryPatch): Promise<Story> {
    return this.request(
      `/api/projects/${encodeURIComponent(projectId)}/stories/${encodeURIComponent(storyId)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    )
  }
}
