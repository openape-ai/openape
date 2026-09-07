import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { useDb } from '../database/drizzle'
import { mirrorPushes, mirrorRefStates, mirrors, repos } from '../database/schema'
import { localMirrorRefs, mayDeleteMirrorRef, pushRefToMirror, remoteMirrorRefs } from './mirror'
import { repoDiskPath } from './repos'

// Serialize all triggers for a repo; events describe a change but reconciliation
// always reads current refs, so delayed events cannot rewind a newer update.
const running = new Map<string, Promise<void>>()

export function reconcileMirrors(repo: { id: string, owner: string, name: string }): Promise<void> {
  const previous = running.get(repo.id) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(() => reconcile(repo))
  running.set(repo.id, next)
  void next.finally(() => { if (running.get(repo.id) === next) running.delete(repo.id) }).catch(() => {})
  return next
}

async function reconcile(repo: { id: string, owner: string, name: string }) {
  const db = useDb()
  const dir = repoDiskPath(repo.owner, repo.name)
  const targets = await db.select().from(mirrors).where(eq(mirrors.repoId, repo.id))
  for (const mirror of targets.filter(m => m.enabled)) {
    const known = await db.select().from(mirrorRefStates).where(eq(mirrorRefStates.mirrorId, mirror.id))
    const old = new Map(known.map(s => [s.ref, s]))
    let source = await localMirrorRefs(dir)
    const refs = new Set([...source.keys(), ...old.keys()])
    let observed: Map<string, string> | undefined
    // At most three attempts per ref. The periodic scanner retries later too.
    for (const ref of refs) {
      for (let attempt = 0; attempt < 3; attempt++) {
        source = await localMirrorRefs(dir)
        const sourceSha = source.get(ref) ?? null
        let targetSha: string | null = null
        let error: string | null = null
        const started = Date.now()
        try {
          observed ??= await remoteMirrorRefs(dir, mirror)
          targetSha = observed.get(ref) ?? null
          if (sourceSha !== targetSha) {
            if (sourceSha === null && !mayDeleteMirrorRef(old.get(ref)?.lastSuccessfulSha ?? null, targetSha)) {
              throw new Error('Deletion refused: target differs from the last successfully replicated SHA')
            }
            const result = await pushRefToMirror(dir, mirror, ref, undefined, { sourceSha, targetSha })
            if (!result.ok) throw new Error(result.error)
            observed = await remoteMirrorRefs(dir, mirror)
            targetSha = observed.get(ref) ?? null
            if (sourceSha !== targetSha) throw new Error('Target changed during verification; will reconcile again')
          }
        }
        catch (err) { error = (err as Error).message.slice(0, 2000); observed = undefined }
        const now = Math.floor(Date.now() / 1000)
        const state = {
          mirrorId: mirror.id, ref, sourceSha, targetSha, checkedAt: now, error,
          syncedAt: error ? old.get(ref)?.syncedAt ?? null : now,
          lastSuccessfulSha: error ? old.get(ref)?.lastSuccessfulSha ?? null : sourceSha,
        }
        await db.insert(mirrorRefStates).values(state).onConflictDoUpdate({ target: [mirrorRefStates.mirrorId, mirrorRefStates.ref], set: state })
        // Keep successful no-op scans out of the attempt history.
        if (error || old.get(ref)?.sourceSha !== sourceSha || old.get(ref)?.error) {
          await db.insert(mirrorPushes).values({ id: ulid(), mirrorId: mirror.id, repoId: repo.id, ref, sha: sourceSha ?? '0'.repeat(40), ok: error ? 0 : 1, error, durationMs: Date.now() - started, createdAt: now })
        }
        if (!error) break
        console.warn(`[ape-git] mirror ${mirror.id} ${ref} attempt ${attempt + 1}: ${error.split('\n')[0]}`)
        if (/rejected|fetch first|Deletion refused|Authentication failed|403/.test(error)) break
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
      }
    }
  }
}

export async function reconcileAllMirrors(): Promise<void> {
  for (const repo of await useDb().select().from(repos)) {
    // A failed repository must not starve the remaining repositories.
    await reconcileMirrors(repo).catch(err => console.error(`[ape-git] reconcile ${repo.owner}/${repo.name}:`, (err as Error).message))
  }
}
