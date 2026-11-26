import { mkdtemp, mkdir, rm, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentConnection } from '../broker/authorization'
import { PodIdentityRefusedError } from './agent'

/** How often a running Pod's identity, key and owner are re-checked at the IdP (issue 666). */
export const revocationCheckMs = 60000

export async function podIdentityFile(root: string, connection: Pick<AgentConnection, 'issuer' | 'subject' | 'accessToken' | 'decisionIssuer' | 'brokered' | 'owner' | 'keyId'>) {
  const controller = new AbortController()
  const secrets: string[] = []
  const temporary = join(root, 'credentials/temporary'); await mkdir(temporary, { recursive: true, mode: 0o700 })
  const directory = await mkdtemp(join(temporary, 'identity-')); const path = join(directory, 'auth.json')
  let refresh: Promise<void> = Promise.resolve(); let check: Promise<void> = Promise.resolve()
  let stopped = false; let refreshing = false; let checking = false; let failure: Error | undefined; let token = ''
  const fail = (error: unknown) => { failure = error instanceof Error ? error : new Error('Pod identity refresh failed'); controller.abort(failure) }
  const remember = (next: string) => { token = next; secrets.push(next, JSON.stringify(next).slice(1, -1)) }
  const write = async () => {
    if (stopped) return
    const stage = join(directory, 'auth.next')
    await writeFile(stage, JSON.stringify({ idp: connection.issuer, email: connection.subject, owner_email: connection.owner, agent_key_id: connection.keyId, access_token: token, expires_at: Math.floor(Date.now() / 1000) + 60, ...(connection.decisionIssuer ? { decision_issuer: connection.decisionIssuer } : {}), ...(connection.brokered ? { brokered: connection.brokered } : {}) }), { mode: 0o600 })
    await rename(stage, path)
  }
  // While an IdP re-check holds the identity cache, the file is rewritten with the token already known.
  const update = async () => { if (!checking) { const next = await connection.accessToken(); if (stopped) return; remember(next) } await write() }
  try { await update() }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
  // ape-shell rejects credentials in their final 30 seconds. Refresh before that
  // boundary, leaving time for the asynchronous token read and atomic file swap.
  // Every revocationCheckMs a separate check authenticates at the IdP and reads the identity's standing, so a slow or
  // unreachable IdP never delays the file refresh; only an explicit refusal of identity, key or owner aborts the run.
  let lastCheck = Date.now()
  const timer = setInterval(() => {
    if (stopped || failure) return
    if (!checking && Date.now() - lastCheck >= revocationCheckMs) {
      checking = true; lastCheck = Date.now()
      check = (async () => {
        try { const next = await connection.accessToken(true); if (!stopped) remember(next) }
        catch (error) { if (error instanceof PodIdentityRefusedError) fail(error) }
        finally { checking = false }
      })()
    }
    if (refreshing) return
    refreshing = true
    refresh = (async () => {
      try { await update() }
      catch (error) { fail(error) }
      finally { refreshing = false }
    })()
  }, 15000)
  return { path, secrets, signal: controller.signal, subject: connection.subject, assertActive: () => { if (failure) throw failure }, close: async () => { stopped = true; clearInterval(timer); await refresh; await check; await rm(directory, { recursive: true, force: true }) } }
}
