import { mkdtemp, mkdir, rm, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentConnection } from '../broker/authorization'

export async function podIdentityFile(root: string, connection: Pick<AgentConnection, 'issuer' | 'subject' | 'accessToken' | 'decisionIssuer' | 'brokered' | 'owner' | 'keyId'>) {
  const controller = new AbortController()
  const secrets: string[] = []
  const temporary = join(root, 'credentials/temporary'); await mkdir(temporary, { recursive: true, mode: 0o700 })
  const directory = await mkdtemp(join(temporary, 'identity-')); const path = join(directory, 'auth.json')
  let refresh: Promise<void> = Promise.resolve(); let stopped = false; let refreshing = false; let failure: Error | undefined
  const update = async () => {
    const token = await connection.accessToken()
    if (stopped) return
    secrets.push(token, JSON.stringify(token).slice(1, -1))
    const stage = join(directory, 'auth.next')
    await writeFile(stage, JSON.stringify({ idp: connection.issuer, email: connection.subject, owner_email: connection.owner, agent_key_id: connection.keyId, access_token: token, expires_at: Math.floor(Date.now() / 1000) + 60, ...(connection.decisionIssuer ? { decision_issuer: connection.decisionIssuer } : {}), ...(connection.brokered ? { brokered: connection.brokered } : {}) }), { mode: 0o600 })
    await rename(stage, path)
  }
  try { await update() }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
  // ape-shell rejects credentials in their final 30 seconds. Refresh before that
  // boundary, leaving time for the asynchronous token read and atomic file swap.
  const timer = setInterval(() => {
    if (refreshing || stopped || failure) return
    refreshing = true
    refresh = (async () => {
      try { await update() }
      catch (error) { failure = error instanceof Error ? error : new Error('Pod identity refresh failed'); controller.abort(failure) }
      finally { refreshing = false }
    })()
  }, 15000)
  return { path, secrets, signal: controller.signal, subject: connection.subject, assertActive: () => { if (failure) throw failure }, close: async () => { stopped = true; clearInterval(timer); await refresh; await rm(directory, { recursive: true, force: true }) } }
}
