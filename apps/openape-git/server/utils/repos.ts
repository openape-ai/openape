import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import { useRuntimeConfig } from 'nitropack/runtime'
import { useDb } from '../database/drizzle'
import { repos } from '../database/schema'

const run = promisify(execFile)

export function reposRoot(): string {
  const config = useRuntimeConfig()
  return resolve(config.gitDataDir as string, 'repos')
}

/**
 * Disk path of a registered repo. Callers pass owner/name that came from the
 * registry (validated on create) — never raw URL segments.
 */
export function repoDiskPath(owner: string, name: string): string {
  return join(reposRoot(), owner, `${name}.git`)
}

export async function createBareRepo(owner: string, name: string): Promise<void> {
  const dir = repoDiskPath(owner, name)
  await mkdir(dirname(dir), { recursive: true })
  // -b main: a bare repo's HEAD defaults to master; the first push to main
  // would otherwise leave HEAD dangling and clones check nothing out (M2 lesson).
  await run('git', ['init', '--bare', '-b', 'main', dir])
}

export async function findRepo(owner: string, name: string) {
  const db = useDb()
  const rows = await db.select().from(repos).where(eq(repos.owner, owner))
  return rows.find(r => r.name === name) ?? null
}
