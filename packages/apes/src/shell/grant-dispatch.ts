import consola from 'consola'
import { loadAuth } from '../config.js'
import { apiFetch, getGrantsEndpoint } from '../http.js'
import { notifyGrantPending } from '../notifications.js'
import {
  GRANT_WAIT_MS,
  isAutoApproved,
  parseShellCommand,
  waitsUntil,
} from '../shapes/index.js'
import { authorizeProgramCall, locateProgram } from '../authorization/program.js'
import type { GrantType, ProgramCall } from '../authorization/program.js'
import { createWaitProgressReporter } from '../wait-progress.js'
import { checkSudoRejection, isApesSelfDispatch } from './apes-self-dispatch.js'
import { programLine } from './program-line.js'

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
  /** ape-shell runs `call` itself instead of handing the typed line to bash. */
  | { kind: 'approved', grantId: string, mode: 'program', call: ProgramCall }
  | { kind: 'approved', grantId: string, mode: 'session' | 'self' }
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
  approval?: GrantType
}

/**
 * Obtain a grant for a shell line so the interactive REPL may execute it
 * against its persistent bash child.
 *
 * Dispatch strategy mirrors the one-shot `ape-shell -c` flow:
 *   1. A line that is exactly one program call (plain words, an executable
 *      file on PATH) is authorized per call at the IdP, which resolves it
 *      with Shapes; a pending request is awaited, a refusal or timeout
 *      denies the line.
 *   2. Every other line (compound, expansions, builtins, unknown program)
 *      uses the generic `ape-shell` session grant for the target host.
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

  // --- 0a. unconditional exit ---
  // `exit` and `exit <code>` always succeed without approval. Getting OUT of
  // the shell is a foot-gun if it requires a grant — agents and humans
  // alike should be able to leave reliably even if everything else is
  // broken (network down, IdP unreachable, expired token).
  const trimmedLine = line.trim().replace(/;+$/, '').trim()
  if (trimmedLine === 'exit' || /^exit \d+$/.test(trimmedLine)) {
    return { kind: 'approved', grantId: 'shell-exit', mode: 'self' }
  }

  const parsed = parseShellCommand(line)

  // --- 0b. apes self-dispatch shortcut ---
  // `apes <subcmd>` invocations from inside the ape-shell REPL are the
  // shell's own control surface — not a new user-authored action that
  // needs approval. See `apes-self-dispatch.ts` for the full rationale.
  // Only `run`, `fetch`, `mcp` remain on the grant path.
  if (isApesSelfDispatch(parsed)) {
    return { kind: 'approved', grantId: 'shell-internal', mode: 'self' }
  }

  // --- 0b. sudo reject ---
  // Shared logic lives in `apes-self-dispatch.ts` so the one-shot path
  // in `commands/run.ts runShellMode` emits the same message.
  const sudoRejection = checkSudoRejection(parsed)
  if (sudoRejection) {
    return { kind: 'denied', reason: sudoRejection.reason }
  }

  // --- 1. Program path ---
  const call = programLine(line)
  // A relative path would be resolved against this process, not the
  // session's working directory.
  if (call?.executable.includes('/') && !call.executable.startsWith('/'))
    return { kind: 'denied', reason: `Use an absolute path or a program on PATH instead of ${call.executable}` }
  const program = call ? await locateProgram(call.executable) : null
  if (call && program) {
    const programCall = { program, argv: call.argv }
    try {
      const authorization = await authorizeProgramCall(programCall, {
        idp,
        subject: auth.email,
        targetHost: options.targetHost,
        grantType: options.approval ?? 'once',
        wait: true,
        onPending: (pending) => {
          consola.info(`Approve at: ${pending.approvalUrl}`)
          notifyGrantPending({
            grantId: pending.grantId,
            approveUrl: pending.approvalUrl,
            command: line.slice(0, 200),
            audience: 'shapes',
            host: options.targetHost,
          })
        },
      })
      if (authorization.kind !== 'authorized')
        return { kind: 'denied', reason: `Grant ${authorization.grantId} is pending` }
      return { kind: 'approved', grantId: authorization.grantId, mode: 'program', call: programCall }
    }
    catch (err) {
      return { kind: 'denied', reason: err instanceof Error ? err.message : String(err) }
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
      && g.request.grant_type !== 'once')
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
    const grant = await apiFetch<{ id: string, status: string, approved_automatically?: boolean }>(grantsUrl, {
      method: 'POST',
      body: {
        requester: auth.email,
        target_host: options.targetHost,
        audience: 'ape-shell',
        grant_type: options.approval ?? 'once',
        command: ['bash', '-c', line],
        reason: `Shell session: ${line.slice(0, 100)}`,
        // Same deadline this loop actually honours, below (#1306).
        waits_until: waitsUntil(),
      },
    })
    if (!isAutoApproved(grant)) {
      consola.info(`Approve at: ${idp}/grant-approval?grant_id=${grant.id}`)
      notifyGrantPending({
        grantId: grant.id,
        approveUrl: `${idp}/grant-approval?grant_id=${grant.id}`,
        command: line.slice(0, 200),
        audience: 'ape-shell',
        host: options.targetHost,
      })
    }

    const maxWait = GRANT_WAIT_MS
    const interval = 3_000
    const start = Date.now()
    // Progress lines on stderr while pending — see wait-progress.ts (#1065).
    const reportProgress = createWaitProgressReporter(grant.id)

    while (Date.now() - start < maxWait) {
      const status = await apiFetch<{ status: string }>(`${grantsUrl}/${grant.id}`)
      if (status.status === 'approved') {
        consola.info(`Grant ${grant.id} approved — continuing`)
        return { kind: 'approved', grantId: grant.id, mode: 'session' }
      }
      if (status.status === 'denied' || status.status === 'revoked')
        return { kind: 'denied', reason: `Grant ${status.status}` }
      reportProgress()
      await new Promise(r => setTimeout(r, interval))
    }

    return { kind: 'denied', reason: 'Grant approval timed out after 5 minutes' }
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { kind: 'denied', reason: `Grant request failed: ${msg}` }
  }
}
