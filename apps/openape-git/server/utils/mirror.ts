import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'

const run = promisify(execFile)

// Only what another forge can interpret. `refs/pull/*` is ape-git's own
// bookkeeping and `refs/notes/*` rarely means anything on the far side.
const MIRRORED_REF = /^refs\/(?:heads|tags)\//

// The credential travels in the environment, never in argv: /proc/<pid>/cmdline
// is world-readable, so a token in the remote URL would be visible to every
// process on the host. argv only carries the shape of this helper.
const CREDENTIAL_HELPER
  = '!f() { echo "username=$APE_GIT_MIRROR_USER"; echo "password=$APE_GIT_MIRROR_TOKEN"; }; f'

export function shouldMirrorRef(ref: string): boolean {
  return MIRRORED_REF.test(ref)
}

/**
 * Strips the credential from anything git wrote. With the token out of both
 * argv and the URL this should never fire — it stays as the last net on a
 * value that gets stored in `mirror_pushes.error` and rendered in the UI.
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

export type GitRunner = (args: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<unknown>

const gitRunner: GitRunner = (args, cwd, env) => run('git', args, { cwd, env, timeout: 120_000 })

/**
 * Pushes one ref to the mirror. Deliberately without `--force` and without
 * `--mirror`: the far side is written to directly as well, so a diverging
 * history has to fail loudly instead of being overwritten.
 */
export async function pushRefToMirror(
  repoDir: string,
  mirror: { url: string, username: string, token: string },
  ref: string,
  exec: GitRunner = gitRunner,
): Promise<MirrorPushResult> {
  const startedAt = Date.now()
  const args = [
    // Empty value first: resets any helper inherited from system or global
    // config, so only ours can answer.
    '-c',
    'credential.helper=',
    '-c',
    `credential.helper=${CREDENTIAL_HELPER}`,
    'push',
    mirror.url,
    `${ref}:${ref}`,
  ]
  const env = {
    ...process.env,
    APE_GIT_MIRROR_USER: mirror.username,
    APE_GIT_MIRROR_TOKEN: mirror.token,
    // Never sit waiting for a prompt nobody can answer.
    GIT_TERMINAL_PROMPT: '0',
  }
  try {
    await exec(args, repoDir, env)
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
