import type { SecretEntry } from './types.js'

/** Compile a glob pattern to a RegExp. Supports `*` (any segment) only. */
function compileGlob(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function literalPrefixLen(glob: string): number {
  const i = glob.indexOf('*')
  return i < 0 ? glob.length : i
}

function targetString(url: URL): string {
  // host[:port]/path — port included only when explicit and non-default.
  const port = url.port ? `:${url.port}` : ''
  const path = url.pathname === '/' ? '' : url.pathname
  return `${url.hostname}${port}${path}`
}

export function matchSecret(target: URL, entries: readonly SecretEntry[]): SecretEntry | null {
  const targetStr = targetString(target)
  let best: { entry: SecretEntry, prefix: number } | null = null

  for (const entry of entries) {
    const re = compileGlob(entry.target)
    if (!re.test(targetStr) && !re.test(`${targetStr}/`)) continue
    const prefix = literalPrefixLen(entry.target)
    if (!best || prefix > best.prefix) {
      best = { entry, prefix }
    }
  }
  return best?.entry ?? null
}
