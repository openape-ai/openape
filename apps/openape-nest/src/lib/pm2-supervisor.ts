// Per-agent pm2 supervisor — Model C of Phase E.
//
// Each agent runs ITS OWN pm2-god daemon as the agent's macOS uid.
// The bridge process is then a direct child of agentx's pm2 (no
// `apes run --as` indirection in the process tree). Each agent's
// `~/.pm2/` is independent: own logs, own restart-history, own crash
// domain. `pm2 list` from agentx's shell shows only that agent's
// processes — clean per-agent operations.
//
// The Nest itself runs as `_openape_nest` and shell-outs to
// `apes run --as <agent> --wait -- pm2 <subcmd>` for every
// management call. escapes-helper's setuid switch puts the pm2
// invocation in the agent's identity; pm2 spawned that way persists
// in the agent's home, and subsequent `pm2 start` calls reattach to
// the same god daemon.
//
// Reconcile semantics (idempotent):
//   - For each registered agent with bridge != null:
//       write /var/openape/nest/agents/<name>/ecosystem.config.js
//       run `apes run --as <name> --wait -- pm2 startOrReload <path>`
//   - For each agent in the registry that's gone:
//       run `apes run --as <name> --wait -- pm2 delete <pm2-name>`
//
// We don't try to talk to per-agent pm2-daemons via JSON RPC from
// here — each runs in a different uid sandbox. Shell-outs through
// apes-run are the only sane channel.

import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import type { AgentEntry } from './registry'

const execFileAsync = promisify(execFile)
// World-readable so agents can read their own ecosystem.config.js
// when pm2 (running as the agent uid) opens the file. The Nest's
// own private state stays under /var/openape/nest/ at mode 750;
// these per-agent ecosystem files are mechanically generated and
// hold no secrets, so 2775 dir + 664 file is fine.
const AGENTS_DIR = '/var/openape/agents'

// `drwxrwsr-x` (group-write + setgid). Lets the nest daemon (running
// as the human user, member of _openape_nest group) create + rewrite
// per-agent files under here, while each agent's pm2 (running as
// the agent uid, NOT in the group) still has world-read to load its
// own ecosystem.config.js. Setgid propagates the parent's group on
// every new entry, so a recursive chown elsewhere won't strand files
// outside the group.
const SHARED_DIR_MODE = 0o2775

function ensureSharedDir(path: string): void {
  // mkdir's mode is masked by the process umask — the setgid bit
  // (S_ISGID) routinely gets stripped. Explicit chmod after the
  // mkdir is the reliable way to set it.
  mkdirSync(path, { recursive: true, mode: SHARED_DIR_MODE })
  if (existsSync(path)) {
    // Best-effort: if the dir already existed with stricter perms
    // from a pre-fix install, repair it. If we lack permission (not
    // group-owner / not root), the chmod fails silently and the
    // operator needs to re-run `migrate-to-service-user.sh` once.
    try { chmodSync(path, SHARED_DIR_MODE) }
    catch { /* not group-owner; relies on out-of-band fix */ }
  }
}

export interface Pm2SupervisorDeps {
  apesBin: string
  log: (line: string) => void
}

function pm2AppName(agentName: string): string {
  return `openape-bridge-${agentName}`
}

function ecosystemPath(agentName: string): string {
  return join(AGENTS_DIR, agentName, 'ecosystem.config.js')
}

// Chat-bridge env keys forwarded from the nest's own env (the compose `.env`
// is the operator's single source of truth); missing keys are simply not set,
// mirroring the macOS path where the bridge logs a fatal if the model is absent.
const CHAT_ENV_FORWARDS = [
  'APE_CHAT_BRIDGE_MODEL',
  'APE_CHAT_BRIDGE_REASONING_EFFORT',
  'LITELLM_BASE_URL',
  'LITELLM_API_KEY',
  'APE_CHAT_BRIDGE_TOOLS',
  'APE_CHAT_BRIDGE_MAX_STEPS',
  'APE_CHAT_BRIDGE_SYSTEM_PROMPT',
  // Chat backend selection (chat.openape.ai vs troop.openape.ai) —
  // honoured by the bridge at startup. See ape-agent/src/bridge.ts.
  'OPENAPE_BRIDGE_TARGET',
  'APE_CHAT_ENDPOINT',
  // The bridge's actual troop endpoint (bridge.ts readConfig → endpoint).
  // Unset in prod → defaults to https://troop.openape.ai; the local stack
  // sets it to https://troop.openape.test so the bridge talks to the local
  // control plane, not production.
  'OPENAPE_TROOP_URL',
]

// pm2's `env:` block is the surviving env source in the container (no launchd,
// sudo strips PATH/env). Chat agents forward the nest's own env; service agents
// get per-agent config (the SP URL differs per agent) from the registry entry,
// falling back to the nest env for the shared LLM bits.
export function ecosystemEnvLines(agent: AgentEntry): string {
  let pairs: Array<[string, string]>
  if (agent.kind === 'service') {
    const br = agent.bridge ?? {}
    const candidates: Record<string, string | undefined> = {
      OPENAPE_SP_BASE_URL: agent.service?.spBaseUrl,
      LITELLM_BASE_URL: br.baseUrl ?? process.env.LITELLM_BASE_URL,
      LITELLM_API_KEY: br.apiKey ?? process.env.LITELLM_API_KEY ?? process.env.LITELLM_MASTER_KEY,
      APE_SERVICE_MODEL: br.model ?? process.env.APE_SERVICE_MODEL ?? process.env.APE_CHAT_BRIDGE_MODEL,
      APE_SERVICE_POLL_MS: agent.service?.pollIntervalMs != null ? String(agent.service.pollIntervalMs) : undefined,
    }
    pairs = Object.entries(candidates).filter((e): e is [string, string] => e[1] !== undefined)
  }
  else {
    pairs = CHAT_ENV_FORWARDS
      .filter(k => process.env[k] !== undefined)
      .map(k => [k, process.env[k] as string])
    // Per-agent overrides from the registry bridge entry — the PM-orchestrator
    // sets these when it spawns a worker at a chosen model + reasoning depth.
    // They win over the forwarded nest-global env.
    const br = agent.bridge ?? {}
    const overrides: Array<[string, string]> = []
    if (br.model) overrides.push(['APE_CHAT_BRIDGE_MODEL', br.model])
    if (br.reasoningEffort) overrides.push(['APE_CHAT_BRIDGE_REASONING_EFFORT', br.reasoningEffort])
    const overrideKeys = new Set(overrides.map(o => o[0]))
    pairs = pairs.filter(p => !overrideKeys.has(p[0])).concat(overrides)
  }
  // The bridge is spawned via `sudo -u <agent>`, which strips the nest's
  // environment — this pm2 `env:` block is the ONLY env the bridge (and its
  // in-process cron runner) sees. OPENAPE_BYPASS_APE_SHELL must ride along or
  // runApeShell falls back to the gated `ape-shell` (absent in the pod) and
  // every scheduled `command` task fails to exec (exit -1). Applies to both
  // kinds — it's a sandbox-level flag, not chat/service-specific.
  if (process.env.OPENAPE_BYPASS_APE_SHELL === '1')
    pairs.push(['OPENAPE_BYPASS_APE_SHELL', '1'])
  // A bind-mounted dev recipe dir, forwarded so the in-bridge cron runner
  // (resolveRecipeDir) runs `command` tasks against the operator's local
  // recipe instead of the synced ~/recipe — iterate on tools/ without a
  // publish→deploy→sync round-trip.
  if (process.env.OPENAPE_RECIPE_DEV_DIR)
    pairs.push(['OPENAPE_RECIPE_DEV_DIR', process.env.OPENAPE_RECIPE_DEV_DIR])
  // Local-CA trust: the bridge makes https calls to the IdP (token refresh) and
  // troop (chat WS + reply post). Behind a `tls internal` proxy those use a CA
  // Node won't trust unless pointed at it — and sudo strips the nest's env, so
  // it must ride in this pm2 block like the flags above. Unset in prod (public
  // certs), so this is a no-op there.
  if (process.env.NODE_EXTRA_CA_CERTS)
    pairs.push(['NODE_EXTRA_CA_CERTS', process.env.NODE_EXTRA_CA_CERTS])
  return pairs.map(([k, v]) => `      ${k}: ${JSON.stringify(v)},`).join('\n')
}

function ecosystemContents(agent: AgentEntry): string {
  const script = agent.kind === 'service' ? 'ape-agent-service' : 'ape-agent'
  const envLines = ecosystemEnvLines(agent)
  const envBlock = envLines
    ? `\n    env: {\n${envLines}\n    },\n`
    : ''
  return `// Auto-generated by Pm2Supervisor for agent '${agent.name}'.
// Edit at runtime via:
//   apes run --as ${agent.name} -- pm2 reload ${pm2AppName(agent.name)}
module.exports = {
  apps: [{
    name: '${pm2AppName(agent.name)}',
    script: '${script}',
    autorestart: true,
    // A bridge must never stay dead. With exponential backoff the delay
    // grows on each rapid crash (capped by pm2), so a flapping bridge
    // (e.g. a transient LLM/token outage) keeps retrying instead of
    // hammering — and min_uptime resets the counter once it stays up
    // 30s, so the high cap is only ever reached by a genuinely broken
    // bridge, not a recoverable hiccup. The old max_restarts:10 let pm2
    // give up permanently after 10 crashes, which stranded agents.
    max_restarts: 1000,
    min_uptime: '30s',
    exp_backoff_restart_delay: 2000,
    merge_logs: true,${envBlock}
  }],
}
`
}

function startScriptPath(agentName: string): string {
  return join(AGENTS_DIR, agentName, 'start.sh')
}

/**
 * Per-agent wrapper script that the supervisor invokes via
 * `apes run --as <agent> -- bash <path>`. The script:
 *   - sets HOME explicitly to the agent's home (escapes-helper
 *     does setuid but doesn't always reset HOME — pm2 then writes
 *     ~/.pm2 to the wrong dir without this)
 *   - sets PM2_HOME to make pm2's location explicit
 *   - redirects stdio to a per-agent log + /dev/null so pm2's
 *     god-daemon detach doesn't keep the parent's pipes open
 *     (which causes the parent's execFile to block on the
 *     timeout instead of returning when pm2 cli exits)
 *   - calls pm2 startOrReload with the ecosystem path
 */
function startScriptContents(agentName: string): string {
  const ecosystem = ecosystemPath(agentName)
  const log = `/var/log/openape/${agentName}-pm2.log`
  // Use $(whoami) instead of a hard-coded /Users/<agentName> lookup so
  // this script works for both legacy macOS agents (bare name) and new
  // prefix-style agents (openape-agent-<n>) — the privileged wrapper
  // (escapes on macOS, sudo on Linux) already setuid'd us to the
  // correct user before exec'ing this script, so $(whoami) returns
  // whichever form actually exists.
  //
  // HOME lookup is platform-conditional: getent (Linux/glibc) reads
  // /etc/passwd or NSS; dscl (macOS) reads the Open Directory.
  return `#!/bin/bash
# Auto-generated by Pm2Supervisor for agent '${agentName}'.
set -e
ME="$(whoami)"
if command -v getent >/dev/null 2>&1; then
  export HOME="$(getent passwd "$ME" | cut -d: -f6)"
else
  export HOME="$(dscl . -read "/Users/$ME" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
fi
test -n "$HOME" || { echo "no home dir for $ME (agent ${agentName})" >&2; exit 1; }
export PM2_HOME="$HOME/.pm2"
mkdir -p "$(dirname "${log}")"
exec pm2 startOrReload ${ecosystem} >> ${log} 2>&1 < /dev/null
`
}

export class Pm2Supervisor {
  private inflight = new Set<string>()

  constructor(private deps: Pm2SupervisorDeps) {}

  /** Bring per-agent pm2 state in line with the registry. Idempotent. */
  async reconcile(desired: AgentEntry[]): Promise<void> {
    for (const agent of desired) {
      // Service agents are always supervised (the worker is the whole point);
      // chat agents only when they carry bridge config.
      if (agent.kind !== 'service' && agent.bridge == null) continue
      if (this.inflight.has(agent.name)) continue
      this.inflight.add(agent.name)
      try { await this.startOrReload(agent) }
      catch (err) {
        this.deps.log(`pm2-supervisor: ${agent.name} reconcile errored: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
      }
      finally { this.inflight.delete(agent.name) }
    }
  }

  /** Stop one agent's pm2 app — used at destroy time. */
  async stop(agentName: string): Promise<void> {
    const name = pm2AppName(agentName)
    try {
      await this.runAsAgent(agentName, ['pm2', 'delete', name])
      this.deps.log(`pm2-supervisor: deleted ${name}`)
    }
    catch (err) {
      // pm2 returns non-zero if the app doesn't exist — fine.
      this.deps.log(`pm2-supervisor: delete ${name}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
    }
  }

  /**
   * Best-effort cleanup — called on Nest shutdown. We don't kill
   *  the per-agent pm2-daemons; they should keep running so bridges
   *  stay alive across Nest restarts. No-op for now.
   */
  async stopAll(): Promise<void> {
    /* deliberately empty — per-agent pm2 outlives the Nest */
  }

  private async startOrReload(agent: AgentEntry): Promise<void> {
    const agentName = agent.name
    // Materialise the ecosystem file under /var/openape/agents/. The
    // dir hierarchy here is shared between the nest daemon (writer,
    // runs as the human user) and the agent's pm2 (reader, runs as
    // the agent uid via apes-run+escapes). escapes inherits ENV but
    // the working dir flips to the agent's $HOME, so absolute paths
    // are mandatory.
    //
    // Perms model: parent `/var/openape/agents/` is pre-provisioned
    // by `migrate-to-service-user.sh` as `_openape_nest:_openape_nest
    // drwxrwsr-x` (group-write + setgid). The setgid bit propagates
    // the group on every new entry, so the nest can mkdir/write here
    // as a regular group member. ensureSharedDir below re-asserts the
    // setgid + group-write bits on the parent because:
    //   1. `mkdirSync(..., { mode })` gets masked by the process's
    //      umask — the setgid bit usually doesn't survive,
    //   2. previously-existing parent dirs from old installs may
    //      still carry the pre-fix `drwxr-xr-x` perms; if Patrick is
    //      in the group the chmodSync repairs them in place,
    //      otherwise it silently fails and the operator runs
    //      `migrate-to-service-user.sh` (which has root).
    ensureSharedDir(AGENTS_DIR)
    const dir = join(AGENTS_DIR, agentName)
    ensureSharedDir(dir)
    const path = ecosystemPath(agentName)
    writeFileSync(path, ecosystemContents(agent), { mode: 0o664 })

    // Drop the per-agent start.sh next to the ecosystem file. Going
    // through a script (not a `bash -c "..."` one-liner) sidesteps
    // arg-quoting issues with escapes-helper, which receives the
    // command as separate argv elements and bash -c then collapses
    // anything past the script-string into positional args
    // ($0, $1, ...) — silently dropping the redirects we expected.
    const startPath = startScriptPath(agentName)
    writeFileSync(startPath, startScriptContents(agentName), { mode: 0o775 })
    void path

    // Run start.sh — pm2 startOrReload's exit code is unreliable
    // (it returns non-zero in some "already running, reloaded" paths
    // even when the work succeeded). We tolerate the non-zero, then
    // probe `pm2 jlist` for the expected app to confirm. The agent
    // log file (/var/log/openape/<agent>-pm2.log) carries the full
    // pm2 output for post-mortem if the probe fails.
    try { await this.runAsAgent(agentName, ['bash', startPath]) }
    catch { /* pm2 exit-code noise — verify via jlist below */ }

    let online = false
    try {
      const { stdout } = await this.runAsAgent(agentName, ['pm2', 'jlist'])
      const json = stdout.match(/\[\s*\{.*\}\s*\]/s)?.[0]
      if (json) {
        const list = JSON.parse(json) as Array<{ name?: string, pm2_env?: { status?: string } }>
        online = list.some(p => p.name === pm2AppName(agentName) && p.pm2_env?.status === 'online')
      }
    }
    catch { /* probe failure → log generic error below */ }

    if (online) {
      this.deps.log(`pm2-supervisor: ${agentName} bridge online (pm2)`)
    }
    else {
      this.deps.log(`pm2-supervisor: ${agentName} bridge NOT online — see /var/log/openape/${agentName}-pm2.log`)
    }
  }

  /**
   * Run a pm2 subcommand AS the agent — escapes-helper does the
   *  setuid switch, then exec's pm2 in the agent's uid.
   *
   *  cwd: the agent process inherits cwd from the spawning Nest
   *  daemon, whose cwd is /var/openape/nest (mode 750, no access for
   *  other uids). Without setting cwd to a world-readable dir, the
   *  child's first `process.cwd()` call (which Node does internally
   *  during module loading) throws EACCES. /tmp is the most portable
   *  always-writable location.
   */
  private async runAsAgent(agentName: string, args: string[]): Promise<{ stdout: string, stderr: string }> {
    // Inside the OpenApe pod (container nest) the container IS the
    // sandbox — no DDISA/escapes to gate against, no auth.json for
    // `apes run --as` to load. Fall back to plain `sudo -u <name> -H`
    // which the container image's sudoers config grants passwordless
    // for nest-managed agent users. Outside the container (host nest
    // on macOS), keep the escapes path so YOLO-grants etc. still apply.
    const bin = process.env.OPENAPE_BYPASS_APE_SHELL === '1' ? 'sudo' : this.deps.apesBin
    const argv = process.env.OPENAPE_BYPASS_APE_SHELL === '1'
      ? ['-n', '-H', '-u', agentName, '--', ...args]
      : ['run', '--as', agentName, '--wait', '--', ...args]
    try {
      return await execFileAsync(bin, argv, {
        maxBuffer: 1024 * 1024, env: process.env, timeout: 60_000, cwd: '/tmp',
      })
    }
    catch (err) {
      // Surface stderr in the error message — the bare execFile
      // error only says "Command failed" without telling us why.
      const e = err as { stderr?: string, stdout?: string, message?: string }
      const detail = (e.stderr ?? '').trim().split('\n').slice(-3).join(' / ')
      const stdoutDetail = (e.stdout ?? '').trim().split('\n').slice(-2).join(' / ')
      throw new Error(`${e.message?.split('\n')[0] ?? 'execFile failed'} | stderr: ${detail || '<empty>'} | stdout: ${stdoutDetail || '<empty>'}`)
    }
  }
}
