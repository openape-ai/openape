import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'

const run = promisify(execFile)

const MIRRORED_REF = /^refs\/(?:heads|tags)\//

const CREDENTIAL_HELPER
  = '!f() { echo "username=$APE_GIT_MIRROR_USER"; echo "password=$APE_GIT_MIRROR_TOKEN"; }; f'

/** Whether a ref belongs on another forge. Branches and tags do; internal refs do not. */
export function shouldMirrorRef(ref: string): boolean {
  return MIRRORED_REF.test(ref)
}

/** Replaces every occurrence of `token` with `***`. */
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

/** Pushes one ref from `repoDir` to `mirror`, reporting the outcome instead of throwing. */
export async function pushRefToMirror(
  repoDir: string,
  mirror: { url: string, username: string, token: string },
  ref: string,
  exec: GitRunner = gitRunner,
): Promise<MirrorPushResult> {
  const startedAt = Date.now()
  const args = [
    // Empty value first: resets any helper from system or global config, so
    // only ours can answer.
    '-c',
    'credential.helper=',
    '-c',
    `credential.helper=${CREDENTIAL_HELPER}`,
    // No --force, no --mirror: the target is written to directly as well, so a
    // divergence must fail rather than overwrite, and its own refs must survive.
    'push',
    mirror.url,
    `${ref}:${ref}`,
  ]
  const env = {
    ...process.env,
    // In the environment, not in argv: /proc/<pid>/cmdline is world-readable.
    APE_GIT_MIRROR_USER: mirror.username,
    APE_GIT_MIRROR_TOKEN: mirror.token,
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
      // The value is stored and rendered; redact in case git ever echoes it.
      ok: false,
      error: redactToken(raw, mirror.token).slice(0, 2000),
      durationMs: Date.now() - startedAt,
    }
  }
}
