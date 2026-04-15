import { execFileSync } from 'node:child_process'
import { hostname } from 'node:os'
import { basename } from 'node:path'
import { defineCommand } from 'citty'
import {
  createShapesGrant,
  extractOption,
  extractShellCommandString,
  extractWrappedCommand,
  fetchGrantToken,
  findExistingGrant,
  loadAdapter,
  loadOrInstallAdapter,
  parseShellCommand,
  resolveCommand,
  verifyAndExecute,
  waitForGrantStatus,
} from '../shapes/index.js'
import consola from 'consola'
import { getIdpUrl, loadAuth, loadConfig } from '../config'
import { getPollMaxMinutes } from '../grant-poll'
import { apiFetch, getGrantsEndpoint } from '../http'
import { CliError, CliExit } from '../errors'
import { notifyGrantPending } from '../notifications'
import { checkSudoRejection, isApesSelfDispatch } from '../shell/apes-self-dispatch'

/**
 * Returns true when the caller asked for the legacy blocking path via
 * `--wait` or `APE_WAIT=1`. Default is non-blocking (async exit).
 */
function shouldWaitForGrant(args: Record<string, unknown>): boolean {
  return args.wait === true || process.env.APE_WAIT === '1'
}

/**
 * Audience of the `apes run` async info block. Drives whether the output
 * targets a human reader (short, friendly) or an AI agent (verbose, with
 * explicit polling protocol).
 *
 * Default is `'agent'` — zero-config for agent ecosystems (openclaw, Claude,
 * etc.), and humans who want brevity just set `APES_USER=human` once in
 * their shell rc. Env var wins over config.toml; unknown values fall back
 * to the agent default.
 */
type ApesUserMode = 'agent' | 'human'

function getUserMode(): ApesUserMode {
  const envValue = process.env.APES_USER
  if (envValue === 'human')
    return 'human'
  if (envValue === 'agent')
    return 'agent'
  const cfg = loadConfig()
  if (cfg.defaults?.user === 'human')
    return 'human'
  return 'agent'
}

// Poll interval + max-minutes helpers live in `../grant-poll.ts` so they
// are shared with the CLI-side wait loop in `commands/grants/run.ts --wait`.
// See that module for the full rationale; in this file we only need the
// max-minutes value for the agent-facing text block.

/**
 * Exit code for the async-default pending-grant path.
 *
 * Default is **75** (`EX_TEMPFAIL` from `sysexits.h`, semantically "temporary
 * failure — try again later"). This is the clearest POSIX-adjacent signal
 * that the command was accepted but the target action has not yet been
 * performed and needs a retry. Unlike exit 1 (general error) or exit 2
 * (usage error), 75 does not collide with common shell conventions, and
 * it happens to be the same code `sendmail` and other mail delivery agents
 * have used for decades to signal "defer and retry".
 *
 * The non-zero exit has a very practical effect on AI-agent consumers:
 * openclaw's exec-runtime (and most similar frameworks) maps non-zero
 * exits to a `failed` / `error` tool-result status, which LLMs attend
 * to much more carefully than a `success` result with the same text in
 * stdout. In 0.9.3 we added explicit agent-facing instructions to the
 * async info block; in practice agents still ignored them because the
 * wrapping tool-result looked like a success. The non-zero exit is the
 * structural attention anchor that the text alone couldn't provide.
 *
 * Overridable via `APES_ASYNC_EXIT_CODE` env var or `config.toml`
 * `defaults.async_exit_code`. Set to `0` to restore the legacy exit-0
 * behaviour (for CI scripts that rely on it, or humans who find the
 * non-zero exit noisy). Valid range is 0–255 (POSIX exit code space);
 * bogus values fall back to the default 75.
 */
function getAsyncExitCode(): number {
  const envValue = process.env.APES_ASYNC_EXIT_CODE
  if (envValue !== undefined && envValue !== '') {
    const n = Number(envValue)
    if (Number.isFinite(n) && n >= 0 && n <= 255)
      return Math.floor(n)
  }
  const cfg = loadConfig()
  const cfgValue = cfg.defaults?.async_exit_code
  if (cfgValue !== undefined && cfgValue !== '') {
    const n = Number(cfgValue)
    if (Number.isFinite(n) && n >= 0 && n <= 255)
      return Math.floor(n)
  }
  return 75 // EX_TEMPFAIL
}

/**
 * Print the async info block for a freshly created pending grant. Two
 * output modes:
 *
 * - **agent** (default): verbose, with an explicit polling protocol so
 *   the consuming LLM knows exactly what to do next. Tells the agent to
 *   poll `apes grants status <id> --json` every N seconds for up to M
 *   minutes, handle each terminal status, and run `apes grants run <id>`
 *   once approved. Every agent in every ecosystem sees the same text
 *   without needing a per-tool skill integration.
 *
 * - **human** (opt-in via `APES_USER=human` or `config.toml` defaults.user):
 *   short, friendly, no polling block. Humans at a terminal know to wait
 *   for approval and then come back.
 *
 * Both modes keep the same core Approve / Status / Execute lines so
 * external scripts that grep for those labels keep working.
 */
function printPendingGrantInfo(grant: { id: string }, idp: string): void {
  const mode = getUserMode()
  const approveUrl = `${idp}/grant-approval?grant_id=${grant.id}`
  const statusCmd = `apes grants status ${grant.id}`
  const executeCmd = `apes grants run ${grant.id}`

  if (mode === 'human') {
    consola.success(`Grant ${grant.id} created — awaiting your approval`)
    console.log(`  Approve in browser:  ${approveUrl}`)
    console.log(`  Check status:        ${statusCmd}`)
    console.log(`  Run after approval:  ${executeCmd}`)
    console.log('')
    console.log('  Tip: Approve as "timed" or "always" in the browser to reuse')
    console.log('  this grant without re-approval on the next invocation.')
    return
  }

  // agent mode (default)
  const maxMin = getPollMaxMinutes()
  consola.success(`Grant ${grant.id} created (pending approval)`)
  console.log(`  Approve:   ${approveUrl}`)
  console.log(`  Status:    ${statusCmd} [--json]`)
  console.log(`  Execute:   ${executeCmd} --wait`)
  console.log('')
  console.log('  For agents:')
  console.log(`    1. Tell the user about the pending grant and the approve URL above.`)
  console.log(`    2. Run \`${executeCmd} --wait\`. This blocks up to ${maxMin} minutes`)
  console.log(`       until the user approves (or denies/timeout) and then executes`)
  console.log(`       the command in a single step. The CLI handles the polling loop`)
  console.log(`       internally — you do not need to poll the status yourself.`)
  console.log(`    3. Exit 0 means approved + executed; stdout is the command output.`)
  console.log(`       Exit 75 (pending) only appears if you accidentally call this`)
  console.log(`       without --wait. Any other non-zero exit means denied, revoked,`)
  console.log(`       used, or timeout — report the reason to the user.`)
  console.log('')
  console.log('  Note: exit code 75 (EX_TEMPFAIL) from this command means "pending,')
  console.log('  retry later" — do not abort your workflow, follow the steps above.')
  console.log('')
  console.log('  Tip: Approve as "timed" or "always" in the browser to let this')
  console.log('  grant be reused on subsequent invocations without re-approval.')
}

export const runCommand = defineCommand({
  meta: {
    name: 'run',
    description: 'Execute a grant-secured command',
  },
  args: {
    'approval': {
      type: 'string',
      description: 'Approval type: once, timed, always',
      default: 'once',
    },
    'reason': {
      type: 'string',
      description: 'Reason for the grant request',
    },
    'adapter': {
      type: 'string',
      description: 'Explicit path to adapter TOML file',
    },
    'as': {
      type: 'string',
      description: 'Execute as this user (delegates to escapes)',
    },
    'host': {
      type: 'string',
      description: 'Target host (default: system hostname)',
    },
    'escapes-path': {
      type: 'string',
      description: 'Path to escapes binary',
      default: 'escapes',
    },
    'idp': {
      type: 'string',
      description: 'IdP URL',
    },
    'shell': {
      type: 'boolean',
      description: 'Shell mode: use session grant with audience ape-shell',
      default: false,
    },
    'wait': {
      type: 'boolean',
      description: 'Block until grant is approved (default: async, print grant info and exit 0). Equivalent to APE_WAIT=1.',
      default: false,
    },
    '_': {
      type: 'positional',
      description: 'Command to execute (after --)',
      required: false,
    },
  },
  async run({ rawArgs, args }) {
    const wrappedCommand = extractWrappedCommand(rawArgs ?? [])

    if (args.shell && wrappedCommand.length > 0) {
      // Shell mode: ape-shell -c "command" → apes run --shell -- bash -c "command"
      await runShellMode(wrappedCommand, args)
      return
    }

    if (wrappedCommand.length > 0) {
      // Adapter mode: apes run [options] -- <cli> <args...>
      await runAdapterMode(wrappedCommand, rawArgs ?? [], args)
    }
    else {
      // Audience mode: apes run <audience> <action>
      // Extract audience and action from rawArgs (before --)
      const positionals = extractPositionals(rawArgs ?? [])
      if (positionals.length < 2)
        throw new Error('Usage: apes run -- <cli> <args...>  OR  apes run <audience> <action>')
      await runAudienceMode(positionals[0]!, positionals[1]!, args)
    }
  },
})

async function runShellMode(
  command: string[],
  args: Record<string, unknown>,
) {
  const auth = loadAuth()
  if (!auth)
    throw new CliError('Not logged in. Run `apes login` first.')

  const idp = getIdpUrl(args.idp as string | undefined)
  if (!idp)
    throw new CliError('No IdP URL configured. Run `apes login` first or pass --idp.')

  // --- 0. apes self-dispatch shortcut (pre-adapter) ---
  // If `ape-shell -c "apes <subcmd>"` was rewritten into this shell-mode
  // invocation, the inner command is a trusted apes self-call and should
  // bypass the grant flow entirely. Same trust-root reasoning as the
  // interactive REPL path in `shell/grant-dispatch.ts` — see
  // `shell/apes-self-dispatch.ts` for the full rationale. Without this,
  // polling flows like openclaw's `ape-shell -c "apes grants status <id>"`
  // cascade infinitely: every poll creates a new pending grant, every
  // grant needs approval, turtles all the way down.
  const innerLine = extractShellCommandString(command)
  if (innerLine) {
    const parsedInner = parseShellCommand(innerLine)
    if (isApesSelfDispatch(parsedInner)) {
      execShellCommand(command)
      return
    }
    // --- 0b. sudo reject ---
    // Parallels the REPL path in `shell/grant-dispatch.ts`. Agents that
    // habitually prefix commands with `sudo` inside `ape-shell -c "…"`
    // would otherwise silently fall through to the generic session-grant
    // path and ultimately hit a bash error with no guidance. Short-circuit
    // with an explicit migration hint to `apes run --as root -- <cmd>`.
    const sudoRejection = checkSudoRejection(parsedInner)
    if (sudoRejection)
      throw new CliError(sudoRejection.reason)
  }

  // Try to handle this command via the shapes adapter system first.
  // This gives us structured grants with resource chains (e.g. "rm file:/tmp/foo.txt")
  // instead of opaque "bash -c …" grants.
  const adapterHandled = await tryAdapterModeFromShell(command, idp, args)
  if (adapterHandled) return

  const grantsUrl = await getGrantsEndpoint(idp)
  const targetHost = (args.host as string) || hostname()

  // Try to find an existing timed/always session grant for ape-shell
  try {
    const grants = await apiFetch<{ data: Array<{ id: string, status: string, request: { audience: string, target_host: string, grant_type: string } }> }>(
      `${grantsUrl}?requester=${encodeURIComponent(auth.email)}&status=approved&limit=20`,
    )
    const sessionGrant = grants.data.find(g =>
      g.request.audience === 'ape-shell'
      && g.request.target_host === targetHost
      && g.request.grant_type !== 'once',
    )
    if (sessionGrant) {
      execShellCommand(command)
      return
    }
  }
  catch {
    // Fall through to creating a new grant
  }

  // No session grant found — request one. Default: 'once', but the approver
  // can upgrade to 'timed' or 'always' during approval to enable reuse.
  consola.info(`Requesting ape-shell session grant on ${targetHost}`)
  const grant = await apiFetch<{ id: string, status: string }>(grantsUrl, {
    method: 'POST',
    body: {
      requester: auth.email,
      target_host: targetHost,
      audience: 'ape-shell',
      grant_type: 'once',
      command: command.slice(0, 3),
      reason: `Shell session: ${command.join(' ').slice(0, 100)}`,
    },
  })

  notifyGrantPending({
    grantId: grant.id,
    approveUrl: `${idp}/grant-approval?grant_id=${grant.id}`,
    command: command.join(' ').slice(0, 200),
    audience: 'ape-shell',
    host: targetHost,
  })

  if (shouldWaitForGrant(args)) {
    consola.info(`Grant requested: ${grant.id}`)
    consola.info('Waiting for approval...')

    const maxWait = 300_000
    const interval = 3_000
    const start = Date.now()

    while (Date.now() - start < maxWait) {
      const status = await apiFetch<{ status: string }>(`${grantsUrl}/${grant.id}`)
      if (status.status === 'approved')
        break
      if (status.status === 'denied' || status.status === 'revoked')
        throw new CliError(`Grant ${status.status}.`)
      await new Promise(r => setTimeout(r, interval))
    }

    execShellCommand(command)
    return
  }

  printPendingGrantInfo(grant, idp)
  throw new CliExit(getAsyncExitCode())
}

/**
 * Try to handle a shell command via the shapes adapter system.
 *
 * Flow:
 * 1. Extract the command string from `bash -c "…"` argv
 * 2. Parse into executable + argv (bail out on compound commands)
 * 3. Load adapter locally, or auto-install from registry
 * 4. Resolve the command against adapter operations → structured CLI grant detail
 * 5. Reuse an existing matching grant, or request a new one and execute
 *
 * Returns true when the command was handled (executed or failed hard).
 * Returns false for any reason — caller should fall back to the generic session grant.
 */
async function tryAdapterModeFromShell(
  command: string[],
  idp: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  const cmdString = extractShellCommandString(command)
  if (!cmdString) return false

  const parsed = parseShellCommand(cmdString)
  if (!parsed) return false
  if (parsed.isCompound) return false

  const loaded = await loadOrInstallAdapter(parsed.executable)
  if (!loaded) return false

  // resolveCommand does a strict comparison against `adapter.cli.executable`,
  // which is always the bare binary name. When the user typed an absolute
  // path we must pass the basename, not the full path.
  const normalizedExecutable = basename(parsed.executable)

  let resolved
  try {
    resolved = await resolveCommand(loaded, [normalizedExecutable, ...parsed.argv])
  }
  catch (err) {
    consola.debug(`ape-shell: adapter resolve failed for "${parsed.raw}":`, err)
    return false
  }

  // Try to reuse an existing matching grant (with widening support)
  try {
    const existingGrantId = await findExistingGrant(resolved, idp)
    if (existingGrantId) {
      consola.info(`Reusing grant ${existingGrantId} for: ${resolved.detail.display}`)
      const token = await fetchGrantToken(idp, existingGrantId)
      await verifyAndExecute(token, resolved)
      return true
    }
  }
  catch {
    // Fall through to request a new grant
  }

  // Request a new grant for this specific command
  const approval = (args.approval ?? 'once') as 'once' | 'timed' | 'always'
  consola.info(`Requesting grant for: ${resolved.detail.display}`)
  const grant = await createShapesGrant(resolved, {
    idp,
    approval,
    reason: (args.reason as string) || `ape-shell: ${resolved.detail.display}`,
  })

  if (grant.similar_grants?.similar_grants?.length) {
    const n = grant.similar_grants.similar_grants.length
    consola.info('')
    consola.info(`  Similar grant(s) found (${n}). Your approver can extend an existing grant to cover this request.`)
  }

  notifyGrantPending({
    grantId: grant.id,
    approveUrl: `${idp}/grant-approval?grant_id=${grant.id}`,
    command: resolved.detail?.display || parsed?.raw || 'unknown',
    audience: resolved.adapter?.cli?.audience ?? 'shapes',
    host: (args.host as string) || hostname(),
  })

  if (shouldWaitForGrant(args)) {
    consola.info(`Grant requested: ${grant.id}`)
    consola.info(`Approve at: ${idp}/grant-approval?grant_id=${grant.id}`)

    const status = await waitForGrantStatus(idp, grant.id)
    if (status !== 'approved')
      throw new CliError(`Grant ${status}`)

    const token = await fetchGrantToken(idp, grant.id)
    await verifyAndExecute(token, resolved)
    return true
  }

  printPendingGrantInfo(grant, idp)
  throw new CliExit(getAsyncExitCode())
}

/**
 * Execute a shell command as [shell, '-c', command_string] via execFileSync.
 *
 * Strips `APES_SHELL_WRAPPER` from the env so any nested `apes` process
 * spawned by the bash child runs in normal citty-dispatch mode instead
 * of self-detecting as ape-shell and rejecting its argv. This mirrors
 * the pty-bridge.ts fix from 0.8.0 (Finding 4) for the one-shot path —
 * openclaw's polling flow `ape-shell -c "apes grants status <id>"` would
 * hit this leak on the nested `apes` call inside bash, manifesting as
 * "ape-shell: unsupported invocation" and breaking the async-grant loop.
 */
function execShellCommand(command: string[]): void {
  if (command.length === 0)
    throw new CliError('No command to execute')
  try {
    const { APES_SHELL_WRAPPER: _wrapperMarker, ...inheritedEnv } = process.env
    execFileSync(command[0]!, command.slice(1), {
      stdio: 'inherit',
      env: inheritedEnv,
    })
  }
  catch (err: unknown) {
    const exitCode = (err as { status?: number }).status || 1
    throw new CliExit(exitCode)
  }
}

function extractPositionals(rawArgs: string[]): string[] {
  const positionals: string[] = []
  const delimiter = rawArgs.indexOf('--')
  const args = delimiter >= 0 ? rawArgs.slice(0, delimiter) : rawArgs

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === 'run')
      continue
    if (arg.startsWith('--')) {
      i++ // skip flag value
      continue
    }
    positionals.push(arg)
  }
  return positionals
}

async function runAdapterMode(
  command: string[],
  rawArgs: string[],
  args: Record<string, unknown>,
) {
  const idp = getIdpUrl(args.idp as string | undefined)
  if (!idp)
    throw new Error('No IdP URL configured. Run `apes login` first or pass --idp.')

  // If caller wants to run as another user (e.g. root), auto-switch to the escapes audience flow.
  // Adapter mode (Shapes) is user-level and cannot elevate privileges.
  if (args.as) {
    await runAudienceMode('escapes', command.join(' '), args)
    return
  }

  const adapterOpt = extractOption(rawArgs, 'adapter')
  const loaded = loadAdapter(command[0]!, adapterOpt)
  const resolved = await resolveCommand(loaded, command)
  const approval = (args.approval ?? 'once') as 'once' | 'timed' | 'always'

  // Try reusing an existing timed/always grant (findExistingGrant skips once grants)
  try {
    const existingGrantId = await findExistingGrant(resolved, idp)
    if (existingGrantId) {
      consola.info(`Reusing existing grant: ${existingGrantId}`)
      const token = await fetchGrantToken(idp, existingGrantId)
      await verifyAndExecute(token, resolved)
      return
    }
  }
  catch {
    // Fall through to creating a new grant
  }

  const grant = await createShapesGrant(resolved, {
    idp,
    approval,
    ...(args.reason ? { reason: args.reason as string } : {}),
  })

  if (grant.similar_grants?.similar_grants?.length) {
    const n = grant.similar_grants.similar_grants.length
    consola.info('')
    consola.info(`  Similar grant(s) found (${n}). Your approver can extend an existing grant to cover this request.`)
    if (grant.similar_grants.widened_details?.length) {
      const wider = grant.similar_grants.widened_details.map(d => d.permission).join(', ')
      consola.info(`  Broader scope: ${wider}`)
    }
    consola.info('')
  }

  if (shouldWaitForGrant(args)) {
    consola.info(`Grant requested: ${grant.id}`)
    consola.info(`Approve at: ${idp}/grant-approval?grant_id=${grant.id}`)

    const status = await waitForGrantStatus(idp, grant.id)
    if (status !== 'approved')
      throw new Error(`Grant ${status}`)

    const token = await fetchGrantToken(idp, grant.id)
    await verifyAndExecute(token, resolved)
    return
  }

  printPendingGrantInfo(grant, idp)
  throw new CliExit(getAsyncExitCode())
}

async function runAudienceMode(
  audience: string,
  action: string,
  args: Record<string, unknown>,
) {
  const auth = loadAuth()
  if (!auth) {
    throw new CliError('Not logged in. Run `apes login` first.')
  }

  const idp = getIdpUrl(args.idp as string | undefined)!
  const grantsUrl = await getGrantsEndpoint(idp)
  const command = action.split(' ')
  const targetHost = (args.host as string) || hostname()

  // Step 1: Request grant
  consola.info(`Requesting ${audience} grant on ${targetHost}: ${command.join(' ')}`)
  const grant = await apiFetch<{ id: string, status: string }>(grantsUrl, {
    method: 'POST',
    body: {
      requester: auth.email,
      target_host: targetHost,
      audience,
      grant_type: args.approval,
      command,
      reason: (args.reason as string) || command.join(' '),
      ...(args.as ? { run_as: args.as } : {}),
    },
  })
  if (!shouldWaitForGrant(args)) {
    printPendingGrantInfo(grant, idp)
    throw new CliExit(getAsyncExitCode())
  }

  consola.success(`Grant requested: ${grant.id}`)

  // Step 2: Wait for approval
  consola.info('Waiting for approval...')
  const maxWait = 300_000
  const interval = 3_000
  const start = Date.now()

  while (Date.now() - start < maxWait) {
    const status = await apiFetch<{ status: string }>(`${grantsUrl}/${grant.id}`)
    if (status.status === 'approved') {
      consola.success('Grant approved!')
      break
    }
    if (status.status === 'denied' || status.status === 'revoked') {
      throw new CliError(`Grant ${status.status}.`)
    }
    await new Promise(r => setTimeout(r, interval))
  }

  // Step 3: Get grant token
  consola.info('Fetching grant token...')
  const { authz_jwt } = await apiFetch<{ authz_jwt: string }>(`${grantsUrl}/${grant.id}/token`, {
    method: 'POST',
  })

  // Step 4: Execute or output token
  if (audience === 'escapes') {
    consola.info(`Executing: ${command.join(' ')}`)
    try {
      // Strip APES_SHELL_WRAPPER so nested `apes` invocations inside
      // the escapes pipe don't self-detect as ape-shell mode. Same
      // rationale as execShellCommand above.
      const { APES_SHELL_WRAPPER: _wrapperMarker, ...inheritedEnv } = process.env
      execFileSync((args['escapes-path'] as string) || 'escapes', ['--grant', authz_jwt, '--', ...command], {
        stdio: 'inherit',
        env: inheritedEnv,
      })
    }
    catch (err: unknown) {
      const exitCode = (err as { status?: number }).status || 1
      throw new CliExit(exitCode)
    }
  }
  else {
    process.stdout.write(authz_jwt)
  }
}
