import consola from 'consola'
import { rewriteApeShellArgs } from './ape-shell'
import { defineCommand, runCommand as runCittyCommand, runMain } from 'citty'
import { loginCommand } from './commands/auth/login'
import { logoutCommand } from './commands/auth/logout'
import { whoamiCommand } from './commands/auth/whoami'
import { listCommand } from './commands/grants/list'
import { inboxCommand } from './commands/grants/inbox'
import { statusCommand } from './commands/grants/status'
import { requestCommand } from './commands/grants/request'
import { requestCapabilityCommand } from './commands/grants/request-capability'
import { approveCommand } from './commands/grants/approve'
import { denyCommand } from './commands/grants/deny'
import { revokeCommand } from './commands/grants/revoke'
import { runGrantCommand } from './commands/grants/run'
import { tokenCommand } from './commands/grants/token'
import { delegateCommand } from './commands/grants/delegate'
import { delegationsCommand } from './commands/grants/delegations'
import { delegationRevokeCommand } from './commands/grants/delegation-revoke'
import { llmCommand } from './commands/grants/llm'
import { adminCommand } from './commands/admin/index'
import { agentCommand } from './commands/agent/index'
import { agentsCommand } from './commands/agents/index'
import { nestCommand } from './commands/nest/index'
import { yoloCommand } from './commands/yolo/index'
import { adapterCommand } from './commands/adapter/index'
import { runCommand } from './commands/run'
import { proxyCommand } from './commands/proxy'
import { explainCommand } from './commands/explain'
import { configGetCommand } from './commands/config/get'
import { configSetCommand } from './commands/config/set'
import { fetchCommand } from './commands/fetch/index'
import { mcpCommand } from './commands/mcp/index'
import { initCommand } from './commands/init/index'
import { enrollCommand } from './commands/enroll'
import { registerUserCommand } from './commands/register-user'
import { utilsCommand } from './commands/utils/index'
import { sessionsCommand } from './commands/sessions/index'
import { dnsCheckCommand } from './commands/dns-check'
import { healthCommand } from './commands/health'
import { workflowsCommand } from './commands/workflows'
import { ApiError } from './http'
import { CliError, CliExit } from './errors'
import { maybeWarnStaleVersion } from './version-check'

// Gracefully handle EPIPE when stdout is closed early (e.g. piped to `head`)
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0)
  throw err
})

declare const __VERSION__: string

// ape-shell mode:
// • `ape-shell -c <command>` rewrites to `apes run --shell -- bash -c <command>` (one-shot)
// • `ape-shell` (no args), `-i`, `-l`, or invoked as a login shell → interactive REPL
// Pass `process.argv0` explicitly so the wrapper script path (which uses
// bash's `exec -a "$0"` to preserve the original argv[0] from login/sshd)
// still benefits from login-shell detection when the cli.js is invoked
// indirectly via the ape-shell-wrapper.sh shim.
const shellRewrite = rewriteApeShellArgs(process.argv, process.argv0)
if (shellRewrite) {
  if (shellRewrite.action === 'rewrite') {
    process.argv = shellRewrite.argv
  }
  else if (shellRewrite.action === 'version') {
    console.log(`ape-shell ${__VERSION__} (OpenApe DDISA shell wrapper)`)
    process.exit(0)
  }
  else if (shellRewrite.action === 'help') {
    console.log(`ape-shell ${__VERSION__} — OpenApe DDISA shell wrapper`)
    console.log('')
    console.log('Usage:')
    console.log('  ape-shell                 Start interactive grant-mediated REPL')
    console.log('  ape-shell -c <command>    Run a single command through the grant flow')
    console.log('  ape-shell -i | -l         Force interactive mode')
    console.log('')
    console.log('Options:')
    console.log('  -c <command>    Execute <command> via the apes grant flow and exit')
    console.log('  -i              Interactive REPL (default when no args are given)')
    console.log('  -l, --login     Login shell semantics — currently same as -i')
    console.log('  --version, -v   Show ape-shell version')
    console.log('  --help, -h      Show this help message')
    process.exit(0)
  }
  else if (shellRewrite.action === 'interactive') {
    // Hand control to the interactive REPL orchestrator. Never returns to
    // citty dispatch. Dynamic import so the startup path for `ape-shell -c`
    // stays lean (node-pty native module is only loaded when needed).
    const { runInteractiveShell } = await import('./shell/orchestrator.js')
    await runInteractiveShell()
    process.exit(0)
  }
  else {
    console.error('ape-shell: unsupported invocation. Try `ape-shell --help`.')
    process.exit(1)
  }
}

const debug = process.argv.includes('--debug')

const grantsCommand = defineCommand({
  meta: {
    name: 'grants',
    description: 'Grant management',
  },
  subCommands: {
    list: listCommand,
    inbox: inboxCommand,
    status: statusCommand,
    request: requestCommand,
    'request-capability': requestCapabilityCommand,
    approve: approveCommand,
    deny: denyCommand,
    revoke: revokeCommand,
    run: runGrantCommand,
    token: tokenCommand,
    delegate: delegateCommand,
    delegations: delegationsCommand,
    'delegation-revoke': delegationRevokeCommand,
    llm: llmCommand,
  },
})

const configCommand = defineCommand({
  meta: {
    name: 'config',
    description: 'Configuration management',
  },
  subCommands: {
    get: configGetCommand,
    set: configSetCommand,
  },
})

const main = defineCommand({
  meta: {
    name: 'apes',
    version: __VERSION__,
    description: 'Unified CLI for OpenApe',
  },
  subCommands: {
    init: initCommand,
    enroll: enrollCommand,
    'register-user': registerUserCommand,
    'dns-check': dnsCheckCommand,
    utils: utilsCommand,
    sessions: sessionsCommand,
    login: loginCommand,
    logout: logoutCommand,
    whoami: whoamiCommand,
    health: healthCommand,
    grants: grantsCommand,
    agent: agentCommand,
    agents: agentsCommand,
    nest: nestCommand,
    yolo: yoloCommand,
    admin: adminCommand,
    run: runCommand,
    proxy: proxyCommand,
    explain: explainCommand,
    adapter: adapterCommand,
    config: configCommand,
    fetch: fetchCommand,
    mcp: mcpCommand,
    workflows: workflowsCommand,
  },
})

// Auto-refresh: every command except those that don't need (or shouldn't
// touch) existing auth gets a transparent token refresh before its handler
// runs. Matches `ape-shell` behavior — users no longer need to re-`apes
// login` when an SP rejects their token; the CLI rotates it on the next
// invocation. login/logout obviously skip; init/enroll/register-user are
// pre-auth bootstrap; dns-check/utils/explain/workflows are diagnostic and
// offline-safe.
const NO_REFRESH_COMMANDS = new Set([
  'login', 'logout',
  'init', 'enroll', 'register-user',
  'dns-check', 'utils', 'explain', 'workflows',
  '--help', '-h', 'help',
  '--version', '-v',
])

async function maybeRefreshAuth(): Promise<void> {
  const sub = process.argv[2]
  if (!sub || NO_REFRESH_COMMANDS.has(sub)) return
  const { loadAuth } = await import('./config.js')
  if (!loadAuth()) return // not logged in — nothing to refresh
  try {
    const { ensureFreshToken } = await import('./http.js')
    await ensureFreshToken()
  }
  catch {
    // Refresh failures are non-fatal — the actual command will surface a
    // proper auth error if the token is genuinely unusable.
  }
}

await maybeRefreshAuth()

// Stale-version notice. Synchronous cache read prints instantly when
// we already know we're behind; the actual npm round-trip is bounded
// to 2s by an AbortSignal so command startup never blocks for long.
// Cached 24h, so this is a one-time cost per day.
await maybeWarnStaleVersion(__VERSION__).catch(() => { /* never block */ })

function handleCliError(err: unknown): never {
  if (err instanceof CliExit) {
    process.exit(err.exitCode)
  }
  if (err instanceof CliError) {
    consola.error(err.message)
    process.exit(err.exitCode)
  }
  if (debug) {
    consola.error(err)
  }
  else {
    consola.error(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err))
  }
  process.exit(1)
}

// citty's `runMain` wraps every command in its own try/catch that dumps the
// error WITH a stack trace via `console.error(error, '\n')` and forces exit 1
// — so our CliExit/CliError handling never runs and controlled exits (e.g. a
// pending grant signalling exit 75) surface as a misleading internal stack
// trace. Route builtin help/version/usage through `runMain` (those paths never
// throw), and execute real commands via `runCommand`, which re-throws so we
// render the error ourselves and honour its exit code. citty's own
// command-resolution errors fall back to `runMain` so usage output is unchanged.
const rawArgs = process.argv.slice(2)
const dashDash = rawArgs.indexOf('--')
const flagScan = dashDash === -1 ? rawArgs : rawArgs.slice(0, dashDash)
const wantsBuiltin = rawArgs.length === 0
  || flagScan.some(a => a === '-h' || a === '--help' || a === '-v' || a === '--version')

if (wantsBuiltin) {
  runMain(main).catch(handleCliError)
}
else {
  runCittyCommand(main, { rawArgs }).catch((err) => {
    // citty's command-resolution errors (unknown/no command) carry an `E_*`
    // code — let runMain render proper usage instead of a bare message.
    const code = (err as { code?: unknown })?.code
    if (typeof code === 'string' && code.startsWith('E_')) {
      runMain(main).catch(handleCliError)
      return
    }
    handleCliError(err)
  })
}
