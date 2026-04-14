import { basename } from 'node:path'
import consola from 'consola'
import { loadAuth } from '../config.js'
import { apiFetch, getGrantsEndpoint } from '../http.js'
import { notifyGrantPending } from '../notifications.js'
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
import { isApesSelfDispatch } from './apes-self-dispatch.js'

/**
 * Result of attempting to obtain a grant for a shell line. On success the
 * REPL may proceed to execute the line in its persistent bash pty. On
 * failure the caller should surface `reason` and discard the line.
 *
 * The `self` mode means the line was a trusted `apes` self-invocation
 * (e.g. `apes grants run <id>`, `apes whoami`, `apes config set ...`) that
 * bypasses the grant flow entirely — see the self-dispatch shortcut in
 * `requestGrantForShellLine` for the rationale.
 */
export type GrantLineResult =
  | { kind: 'approved', grantId: string, mode: 'adapter' | 'session' | 'self' }
  | { kind: 'denied', reason: string }

// The APES_GATED_SUBCOMMANDS blocklist + `isApesSelfDispatch` helper
// live in `./apes-self-dispatch.ts` so the same rule is shared with the
// one-shot `ape-shell -c` path in `commands/run.ts runShellMode`. See
// that module for the full rationale.

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

  const parsed = parseShellCommand(line)

  // --- 0. apes self-dispatch shortcut ---
  // `apes <subcmd>` invocations from inside the ape-shell REPL are the
  // shell's own control surface — not a new user-authored action that
  // needs approval. See `apes-self-dispatch.ts` for the full rationale.
  // Only `run`, `fetch`, `mcp` remain on the grant path.
  if (isApesSelfDispatch(parsed)) {
    return { kind: 'approved', grantId: 'shell-internal', mode: 'self' }
  }

  // --- 0b. sudo reject ---
  // `sudo` is not available inside ape-shell: the wrapper user is not in
  // /etc/sudoers by design. Agents and humans should use the explicit
  // `apes run --as root -- <cmd>` flow which routes through escapes and
  // requires a fresh grant per invocation. We detect the literal `sudo`
  // token at the line start (after trim) and return a denied result with
  // a clear migration hint instead of silently handing the line to bash
  // where it would fail with a less helpful error.
  if (parsed && !parsed.isCompound && basename(parsed.executable) === 'sudo') {
    const rest = parsed.argv.join(' ').trim()
    const hint = rest.length > 0
      ? `apes run --as root -- ${rest}`
      : 'apes run --as root -- <cmd>'
    return {
      kind: 'denied',
      reason: `sudo is not available in ape-shell. Use \`${hint}\` for privileged commands.`,
    }
  }

  // --- 1. Adapter path ---
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
            if (process.env.APES_QUIET_GRANT_REUSE !== '1')
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

        notifyGrantPending({
          grantId: grant.id,
          approveUrl: `${idp}/grant-approval?grant_id=${grant.id}`,
          command: resolved.detail?.display ?? line,
          audience: resolved.adapter?.cli?.audience ?? 'shapes',
          host: options.targetHost,
        })

        const status = await waitForGrantStatus(idp, grant.id)
        if (status !== 'approved') {
          return { kind: 'denied', reason: `Grant ${status}` }
        }
        consola.info(`Grant ${grant.id} approved — continuing`)

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
      if (process.env.APES_QUIET_GRANT_REUSE !== '1')
        consola.info(`Reusing ape-shell session grant ${sessionGrant.id} on ${options.targetHost}`)
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

    notifyGrantPending({
      grantId: grant.id,
      approveUrl: `${idp}/grant-approval?grant_id=${grant.id}`,
      command: line.slice(0, 200),
      audience: 'ape-shell',
      host: options.targetHost,
    })

    const maxWait = 300_000
    const interval = 3_000
    const start = Date.now()

    while (Date.now() - start < maxWait) {
      const status = await apiFetch<{ status: string }>(`${grantsUrl}/${grant.id}`)
      if (status.status === 'approved') {
        consola.info(`Grant ${grant.id} approved — continuing`)
        return { kind: 'approved', grantId: grant.id, mode: 'session' }
      }
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
