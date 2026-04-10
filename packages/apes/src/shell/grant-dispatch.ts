import { basename } from 'node:path'
import consola from 'consola'
import { loadAuth } from '../config.js'
import { apiFetch, getGrantsEndpoint } from '../http.js'
import {
  createShapesGrant,
  fetchGrantToken,
  findExistingGrant,
  loadOrInstallAdapter,
  parseShellCommand,
  resolveCommand,
  verifyAndConsume,
  waitForGrantStatus,
} from '../shapes/index.js'

/**
 * Result of attempting to obtain a grant for a shell line. On success the
 * REPL may proceed to execute the line in its persistent bash pty. On
 * failure the caller should surface `reason` and discard the line.
 */
export type GrantLineResult =
  | { kind: 'approved', grantId: string, mode: 'adapter' | 'session' }
  | { kind: 'denied', reason: string }

/**
 * Options the orchestrator passes to `requestGrantForShellLine`. They
 * mirror what the `apes run --shell` path reads from its citty args, but
 * come directly from the shell session context instead.
 */
export interface GrantLineOptions {
  /** Target host name. Usually `os.hostname()`. */
  targetHost: string
  /** Approval mode — almost always 'once' for interactive shell lines. */
  approval?: 'once' | 'timed' | 'always'
}

/**
 * Obtain a grant for a shell line so the interactive REPL may execute it
 * against its persistent bash child.
 *
 * Dispatch strategy mirrors the existing one-shot `tryAdapterModeFromShell`
 * flow:
 *   1. Try to resolve the line as an adapter-backed command (structured
 *      grant with resource chain / permission).
 *   2. If the adapter path succeeds, reuse an existing matching grant or
 *      request a new one, verify + consume it.
 *   3. If the adapter path fails (compound line, no matching adapter,
 *      resolve failure) fall back to a generic `ape-shell` session grant
 *      for the target host.
 *
 * Returns without executing anything. The caller (the orchestrator)
 * decides how to run the line — typically by writing it to bash's pty.
 */
export async function requestGrantForShellLine(
  line: string,
  options: GrantLineOptions,
): Promise<GrantLineResult> {
  const auth = loadAuth()
  if (!auth) {
    return { kind: 'denied', reason: 'Not logged in. Run `apes login` first.' }
  }
  const idp = auth.idp
  if (!idp) {
    return { kind: 'denied', reason: 'No IdP URL configured. Run `apes login` first.' }
  }

  // --- 1. Adapter path ---
  const parsed = parseShellCommand(line)
  if (parsed && !parsed.isCompound) {
    try {
      const loaded = await loadOrInstallAdapter(parsed.executable)
      if (loaded) {
        const normalizedExecutable = basename(parsed.executable)
        const resolved = await resolveCommand(loaded, [normalizedExecutable, ...parsed.argv])

        // Try to reuse an existing matching grant first.
        try {
          const existingGrantId = await findExistingGrant(resolved, idp)
          if (existingGrantId) {
            consola.info(`Reusing grant ${existingGrantId} for: ${resolved.detail.display}`)
            const token = await fetchGrantToken(idp, existingGrantId)
            await verifyAndConsume(token, resolved)
            return { kind: 'approved', grantId: existingGrantId, mode: 'adapter' }
          }
        }
        catch (err) {
          consola.debug(`ape-shell: findExistingGrant failed, will request new grant:`, err)
        }

        // Request a new adapter-backed grant.
        consola.info(`Requesting grant for: ${resolved.detail.display}`)
        const grant = await createShapesGrant(resolved, {
          idp,
          approval: options.approval ?? 'once',
          reason: `ape-shell: ${resolved.detail.display}`,
        })
        consola.info(`Approve at: ${idp}/grant-approval?grant_id=${grant.id}`)

        const status = await waitForGrantStatus(idp, grant.id)
        if (status !== 'approved') {
          return { kind: 'denied', reason: `Grant ${status}` }
        }

        const token = await fetchGrantToken(idp, grant.id)
        await verifyAndConsume(token, resolved)
        return { kind: 'approved', grantId: grant.id, mode: 'adapter' }
      }
    }
    catch (err) {
      // Adapter resolution failed — debug-log and fall through to the
      // generic session grant path.
      consola.debug(`ape-shell: adapter resolve failed, falling back to session grant:`, err)
    }
  }

  // --- 2. Generic session grant (ape-shell audience) ---
  const grantsUrl = await getGrantsEndpoint(idp)

  // Try to reuse an existing timed/always session grant first.
  try {
    const grants = await apiFetch<{ data: Array<{ id: string, status: string, request: { audience: string, target_host: string, grant_type: string } }> }>(
      `${grantsUrl}?requester=${encodeURIComponent(auth.email)}&status=approved&limit=20`,
    )
    const sessionGrant = grants.data.find(g =>
      g.request.audience === 'ape-shell'
      && g.request.target_host === options.targetHost
      && g.request.grant_type !== 'once',
    )
    if (sessionGrant) {
      return { kind: 'approved', grantId: sessionGrant.id, mode: 'session' }
    }
  }
  catch (err) {
    consola.debug(`ape-shell: session grant lookup failed:`, err)
  }

  // Request a new session grant. The approver sees the literal shell line.
  consola.info(`Requesting ape-shell session grant on ${options.targetHost}`)
  try {
    const grant = await apiFetch<{ id: string, status: string }>(grantsUrl, {
      method: 'POST',
      body: {
        requester: auth.email,
        target_host: options.targetHost,
        audience: 'ape-shell',
        grant_type: options.approval ?? 'once',
        command: ['bash', '-c', line],
        reason: `Shell session: ${line.slice(0, 100)}`,
      },
    })
    consola.info(`Approve at: ${idp}/grant-approval?grant_id=${grant.id}`)

    const maxWait = 300_000
    const interval = 3_000
    const start = Date.now()

    while (Date.now() - start < maxWait) {
      const status = await apiFetch<{ status: string }>(`${grantsUrl}/${grant.id}`)
      if (status.status === 'approved')
        return { kind: 'approved', grantId: grant.id, mode: 'session' }
      if (status.status === 'denied' || status.status === 'revoked')
        return { kind: 'denied', reason: `Grant ${status.status}` }
      await new Promise(r => setTimeout(r, interval))
    }

    return { kind: 'denied', reason: 'Grant approval timed out after 5 minutes' }
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { kind: 'denied', reason: `Grant request failed: ${msg}` }
  }
}
