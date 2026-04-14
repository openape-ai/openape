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

/**
 * Subset of `apes` subcommands that the REPL still routes through the
 * normal grant flow, even after the self-dispatch shortcut below. These
 * are the three categories where the shell-grant layer adds real security
 * value that isn't duplicated by server-side auth gates or local-only
 * config-file semantics:
 *
 *   - `run`   — spawns arbitrary executables, the core of the grant system
 *   - `fetch` — forwards the bearer token to a user-specified URL
 *   - `mcp`   — binds a network port and serves a persistent API
 *
 * Every other `apes <subcmd>` either reads state, mutates the user's own
 * local config, or talks to the IdP through endpoints that are already
 * scoped by the auth token — so gating them in the shell is redundant
 * friction, and breaks `apes grants run <id>` recursively once 0.9.0's
 * async-default grant flow is in play.
 *
 * Keep this list in sync with the blocklist snapshot test in
 * `shell-grant-dispatch.test.ts` — that test is the tripwire that forces
 * a review decision whenever a new top-level apes subcommand is added.
 */
const APES_GATED_SUBCOMMANDS = new Set(['run', 'fetch', 'mcp'])

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
  // needs approval. The REPL is already authenticated as an apes agent;
  // its subcommands either talk to IdP endpoints that are scoped by the
  // same auth token (grants, admin, register-user, ...), mutate local
  // config files in the user's own $HOME (login, logout, config,
  // adapter, enroll, init), or are strictly read-only (whoami, health,
  // explain, dns-check, workflows). Gating them in the shell is
  // redundant friction and, more importantly, makes `apes grants run
  // <id>` recursively unusable under the 0.9.0 async-default grant
  // flow. Only the three genuinely-dangerous subcommands in
  // APES_GATED_SUBCOMMANDS (run/fetch/mcp) stay on the grant path.
  if (parsed && !parsed.isCompound) {
    const invokedName = basename(parsed.executable)
    if (invokedName === 'apes' || invokedName === 'apes.js') {
      const subCommand = parsed.argv[0]
      if (subCommand && !APES_GATED_SUBCOMMANDS.has(subCommand)) {
        return { kind: 'approved', grantId: 'shell-internal', mode: 'self' }
      }
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
