import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
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
 * `recipeRef` is `<owner>/<name>[/<subdir>…]@<ref>` (optionally prefixed
 * `github.com/`). We split on the LAST `@` so a ref that itself
 * contains `@` survives, clone shallow at exactly that ref, and drop a
 * `.recipe-ref` marker so a re-sync at the same ref is a no-op.
 *
 * The optional subdir path selects a recipe inside a catalog repo
 * (e.g. `openape-ai/agent-catalog/ceo@ceo-v0.1.0`): the repo is cloned
 * to a staging dir and only the subdirectory's content lands in
 * `recipeDir`, so consumers see the recipe root either way.
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
    consola.warn(`recipe: malformed recipeRef "${recipeRef}" (expected <owner>/<name>[/<subdir>]@<ref>) — skipping checkout`)
    return
  }
  const spec = recipeRef.slice(0, at)
  const ref = recipeRef.slice(at + 1)
  const slug = spec.startsWith(GITHUB_PREFIX) ? spec.slice(GITHUB_PREFIX.length) : spec
  if (!slug || !ref) {
    consola.warn(`recipe: malformed recipeRef "${recipeRef}" (empty slug or ref) — skipping checkout`)
    return
  }
  const segments = slug.split('/').filter(Boolean)
  if (segments.length < 2) {
    consola.warn(`recipe: malformed recipeRef "${recipeRef}" (expected <owner>/<name>[/<subdir>]@<ref>) — skipping checkout`)
    return
  }
  // Path-traversal guard: the subdir path is operator-supplied (a pasted
  // "Custom…" ref). Reject `.`/`..`/backslash segments so the cpSync below
  // cannot escape the staging clone dir.
  if (segments.some(s => s === '.' || s === '..' || s.includes('\\'))) {
    consola.warn(`recipe: unsafe path segment in recipeRef "${recipeRef}" — skipping checkout`)
    return
  }
  const repoSlug = segments.slice(0, 2).join('/')
  const subdir = segments.slice(2).join('/')

  const markerPath = join(recipeDir, MARKER_FILE)
  if (existsSync(markerPath)) {
    try {
      if (readFileSync(markerPath, 'utf8') === recipeRef) return
    }
    catch { /* unreadable marker — fall through and re-clone */ }
  }

  const cloneUrl = `https://github.com/${repoSlug}`
  const staging = subdir ? `${recipeDir}.checkout` : recipeDir
  try {
    rmSync(recipeDir, { recursive: true, force: true })
    if (subdir)
      rmSync(staging, { recursive: true, force: true })
    exec('git', ['clone', '--depth', '1', '--branch', ref, cloneUrl, staging])
    if (subdir) {
      const src = join(staging, subdir)
      // Belt-and-suspenders: even after the segment guard, assert the
      // resolved source stays inside the staging clone before copying.
      if (!resolve(src).startsWith(resolve(staging) + sep)) {
        consola.warn(`recipe: subdirectory "${subdir}" escapes the checkout dir — skipping`)
        rmSync(staging, { recursive: true, force: true })
        return
      }
      if (!existsSync(src)) {
        consola.warn(`recipe: subdirectory "${subdir}" not found in ${repoSlug}@${ref} — skipping checkout`)
        rmSync(staging, { recursive: true, force: true })
        return
      }
      cpSync(src, recipeDir, { recursive: true })
      rmSync(staging, { recursive: true, force: true })
    }
    writeFileSync(markerPath, recipeRef)
    consola.info(`recipe: checked out ${slug}@${ref} → ${recipeDir}`)
  }
  catch (err) {
    consola.warn(`recipe: checkout of ${slug}@${ref} failed — ${err instanceof Error ? err.message : String(err)}`)
    if (subdir)
      rmSync(staging, { recursive: true, force: true })
  }
}
