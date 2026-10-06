import { mkdtemp, mkdir, rm, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConnectionManager } from '../connections/manager'

export async function shellIdentity(root: string, podId: string, connections: ConnectionManager) {
  const connection = await connections.podConnection(podId)
  const temporary = join(root, 'credentials/temporary'); await mkdir(temporary, { recursive: true, mode: 0o700 })
  const directory = await mkdtemp(join(temporary, 'shell-')); const path = join(directory, 'auth.json')
  let refresh: Promise<void> = Promise.resolve(); let stopped = false; let refreshing = false; let failure: Error | undefined
  const update = async () => {
    const token = await connection.accessToken()
    if (stopped) return
    const stage = join(directory, 'auth.next')
    await writeFile(stage, JSON.stringify({ idp: connection.issuer, email: connection.subject, access_token: token, expires_at: Math.floor(Date.now() / 1000) + 60 }), { mode: 0o600 })
    await rename(stage, path)
  }
  try { await update() }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
  const timer = setInterval(() => {
    if (refreshing || stopped || failure) return
    refreshing = true
    refresh = (async () => {
      try { await update() }
      catch (error) { failure = error instanceof Error ? error : new Error('Pod shell identity refresh failed') }
      finally { refreshing = false }
    })()
  }, 30000)
  return { path, subject: connection.subject, assertActive: () => { if (failure) throw failure }, close: async () => { stopped = true; clearInterval(timer); await refresh; await rm(directory, { recursive: true, force: true }) } }
}
