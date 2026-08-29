import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

// Only what another forge can interpret. `refs/pull/*` is ape-git's own
// bookkeeping and `refs/notes/*` rarely means anything on the far side.
const MIRRORED_REF = /^refs\/(?:heads|tags)\//

export function shouldMirrorRef(ref: string): boolean {
  return MIRRORED_REF.test(ref)
}

export function mirrorRemoteUrl(url: string, username: string, token: string): string {
  const target = new URL(url)
  target.username = encodeURIComponent(username)
  target.password = encodeURIComponent(token)
  return target.toString()
}

/**
 * Strips the credential from anything git wrote. Modern git already redacts
 * credentials from the URLs in its own messages, so in practice this rarely
 * fires — it stays because that behaviour is git's choice, not a guarantee we
 * control, and the value being guarded is a write token for another forge.
 */
export function redactToken(text: string, token: string): string {
  if (!token) return text
  return text.split(token).join('***')
}

export interface MirrorPushResult {
  ok: boolean
  error?: string
  durationMs: number
}

/**
 * Pushes one ref to the mirror. Deliberately without `--force` and without
 * `--mirror`: the far side is written to directly as well, so a diverging
 * history has to fail loudly instead of being overwritten.
 */
export type GitRunner = (args: string[], cwd: string) => Promise<unknown>

const gitRunner: GitRunner = (args, cwd) => run('git', args, { cwd, timeout: 120_000 })

export async function pushRefToMirror(
  repoDir: string,
  mirror: { url: string, username: string, token: string },
  ref: string,
  exec: GitRunner = gitRunner,
): Promise<MirrorPushResult> {
  const startedAt = Date.now()
  const remote = mirrorRemoteUrl(mirror.url, mirror.username, mirror.token)
  try {
    await exec(['push', remote, `${ref}:${ref}`], repoDir)
    return { ok: true, durationMs: Date.now() - startedAt }
  }
  catch (err: unknown) {
    const e = err as { stderr?: string, message?: string }
    const raw = (e.stderr || e.message || 'push failed').trim()
    return {
      ok: false,
      error: redactToken(raw, mirror.token).slice(0, 2000),
      durationMs: Date.now() - startedAt,
    }
  }
}
