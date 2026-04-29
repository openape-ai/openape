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
  return `${url.hostname}${port}${path}`.replace(/^\/+/, '')
}

export function matchSecret(target: URL, entries: readonly SecretEntry[]): SecretEntry | null {
  const targetStr = targetString(target)
  let best: { entry: SecretEntry, prefix: number, idx: number } | null = null

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    const re = compileGlob(entry.target)
    if (!re.test(targetStr) && !re.test(`${targetStr}/`)) continue
    const prefix = literalPrefixLen(entry.target)
    if (!best || prefix > best.prefix || (prefix === best.prefix && i < best.idx)) {
      best = { entry, prefix, idx: i }
    }
  }
  return best?.entry ?? null
}
