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
  expected?: { sourceSha: string | null, targetSha: string | null },
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
    ...(expected?.sourceSha === null ? [`--force-with-lease=${ref}:${expected.targetSha ?? ''}`] : []),
    mirror.url,
    `${expected ? expected.sourceSha ?? '' : ref}:${ref}`,
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

export interface MirrorCredential { url: string, username: string, token: string }

/** Raw object IDs preserve annotated tags, unlike rev-parse ref^{commit}. */
export async function localMirrorRefs(dir: string): Promise<Map<string, string>> {
  const { stdout } = await run('git', ['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads', 'refs/tags'], { cwd: dir })
  return parseMirrorRefs(stdout)
}

export function parseMirrorRefs(output: string): Map<string, string> {
  return new Map(output.trim().split('\n').flatMap((line) => {
    const [sha, ref] = line.trim().split(/\s+/)
    return sha && ref && /^[a-f0-9]{40,64}$/.test(sha) && shouldMirrorRef(ref) && !ref.endsWith('^{}') ? [[ref, sha]] : []
  }))
}

export async function remoteMirrorRefs(dir: string, mirror: MirrorCredential): Promise<Map<string, string>> {
  try {
    const { stdout } = await run('git', ['-c', 'credential.helper=', '-c', `credential.helper=${CREDENTIAL_HELPER}`, 'ls-remote', '--refs', mirror.url, 'refs/heads/*', 'refs/tags/*'], {
      cwd: dir,
      timeout: 30_000,
      env: { ...process.env, APE_GIT_MIRROR_USER: mirror.username, APE_GIT_MIRROR_TOKEN: mirror.token, GIT_TERMINAL_PROMPT: '0' },
    })
    return parseMirrorRefs(stdout)
  }
  catch (error) {
    throw new Error(redactToken((error as Error).message, mirror.token).slice(0, 2000))
  }
}

/** Only delete a previously replicated ref whose target has not changed. */
export function mayDeleteMirrorRef(lastSuccessfulSha: string | null, targetSha: string | null): boolean {
  return targetSha === null || (lastSuccessfulSha !== null && lastSuccessfulSha === targetSha)
}
