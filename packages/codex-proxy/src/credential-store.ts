import type { CodexCredential } from './codex-credential'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { ensureFreshCodexCredential } from './codex-credential'

export function loadCodexCredential(path: string): CodexCredential {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<CodexCredential>
  if (!raw.access_token || !raw.refresh_token || typeof raw.expires_at !== 'number' || !raw.account_id)
    throw new Error(`invalid codex credential at ${path}`)
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    id_token: raw.id_token ?? '',
    expires_at: raw.expires_at,
    account_id: raw.account_id,
  }
}

export function saveCodexCredential(path: string, cred: CodexCredential): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(cred, null, 2), { mode: 0o600 })
}

/**
 * File-backed Codex credential with a single-flight refresh: concurrent callers
 * share one in-flight refresh and a freshly-refreshed token is written back to
 * disk. One proxy process per nest, so an in-process mutex is enough — no
 * cross-process lock needed.
 */
export class CodexCredentialStore {
  private inflight: Promise<CodexCredential> | null = null

  constructor(private readonly path: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async get(nowMs: number = Date.now()): Promise<CodexCredential> {
    if (this.inflight)
      return this.inflight
    const run = (async () => {
      const cred = loadCodexCredential(this.path)
      const fresh = await ensureFreshCodexCredential(cred, this.fetchImpl, nowMs)
      if (fresh !== cred)
        saveCodexCredential(this.path, fresh)
      return fresh
    })()
    this.inflight = run
    try {
      return await run
    }
    finally {
      this.inflight = null
    }
  }
}
