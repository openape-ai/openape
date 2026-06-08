import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import consola from 'consola'

/**
 * Just the slice of `execFileSync` this module uses — `(file, args)`.
 * Narrowed so tests can inject a recorder without pulling the full
 * overload set.
 */
type ExecFn = (file: string, args?: readonly string[]) => Buffer | string

const MARKER_FILE = '.recipe-ref'
const GITHUB_PREFIX = 'github.com/'

/**
 * Check out the agent's recipe repo at the operator-pinned ref.
 *
 * `recipeRef` is `<owner>/<name>@<ref>` (optionally prefixed
 * `github.com/`). We split on the LAST `@` so a ref that itself
 * contains `@` survives, clone shallow at exactly that ref, and drop a
 * `.recipe-ref` marker so a re-sync at the same ref is a no-op.
 *
 * NEVER throws: a broken recipe (missing repo, bad ref, network blip)
 * must not crash the agent sync — it logs and returns, leaving no
 * marker so the next sync retries.
 */
export function ensureRecipeCheckout(
  recipeRef: string,
  recipeDir: string,
  exec: ExecFn = execFileSync,
): void {
  const at = recipeRef.lastIndexOf('@')
  if (at <= 0) {
    consola.warn(`recipe: malformed recipeRef "${recipeRef}" (expected <owner>/<name>@<ref>) — skipping checkout`)
    return
  }
  const spec = recipeRef.slice(0, at)
  const ref = recipeRef.slice(at + 1)
  const slug = spec.startsWith(GITHUB_PREFIX) ? spec.slice(GITHUB_PREFIX.length) : spec
  if (!slug || !ref) {
    consola.warn(`recipe: malformed recipeRef "${recipeRef}" (empty slug or ref) — skipping checkout`)
    return
  }

  const markerPath = join(recipeDir, MARKER_FILE)
  if (existsSync(markerPath)) {
    try {
      if (readFileSync(markerPath, 'utf8') === recipeRef) return
    }
    catch { /* unreadable marker — fall through and re-clone */ }
  }

  const cloneUrl = `https://github.com/${slug}`
  try {
    rmSync(recipeDir, { recursive: true, force: true })
    exec('git', ['clone', '--depth', '1', '--branch', ref, cloneUrl, recipeDir])
    writeFileSync(markerPath, recipeRef)
    consola.info(`recipe: checked out ${slug}@${ref} → ${recipeDir}`)
  }
  catch (err) {
    consola.warn(`recipe: checkout of ${slug}@${ref} failed — ${err instanceof Error ? err.message : String(err)}`)
  }
}
