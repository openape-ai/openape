// openclaw runtime adapter — runs a foreign one-shot agent runtime under our
// DDISA identity. openclaw (docs.openclaw.ai, pinned 2026.6.8) has no daemon for
// our purposes: `openclaw agent --local --json --message …` runs one embedded
// turn, reading model-provider keys from its config. We:
//   - prepare(): write a per-agent openclaw config (provider → our LLM gateway)
//     + workspace bootstrap files (SOUL/AGENTS/IDENTITY) from the agent's persona,
//     all isolated to the agent's home via OPENCLAW_CONFIG_PATH/OPENCLAW_STATE_DIR.
//   - invoke(): exec one turn per incoming chat message, session continuity via
//     `--session-key`. The reply is returned for the caller to post back.
//
// Tools are CLI-as-tool (the MVP decision): openclaw gets shell/exec and the
// agent's own `apes`/`ape-tasks`/`ape-troop` CLIs, which read the agent's
// auth.json — so actions land under the DDISA identity with no extra wiring.
//
// ponytail: config is written as plain JSON (openclaw reads OPENCLAW_CONFIG_PATH).
// Switch to `openclaw config patch --stdin` (schema-validated) if openclaw's
// schema drifts and the flat write breaks.

import { execFile } from 'node:child_process'
import { chownSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Models the gateway's default path serves (the unprefixed litellm deployments). */
const GATEWAY_MODELS = ['LocalCore-Instant', 'LocalCore-Thinking']
const PROVIDER = 'openape'
// The gateway speaks the OpenAI chat-completions dialect (codex-proxy → litellm).
const PROVIDER_API = 'openai-completions'

export interface OpenclawAgent {
  name: string
  email: string
  home: string
  /** Agent OS uid — when set, prepareOpenclawHome chowns the .openclaw tree to
   * it so a `sudo -u <agent>` exec can read its config + write state. */
  uid?: number
}

export interface OpenclawRuntime {
  /** OpenAI-compatible gateway base URL, e.g. https://llms.openape.ai/v1 */
  apiBase: string
  /** Gateway key (mirrors the bridge's LITELLM_API_KEY). */
  apiKey: string
  /** Model id without provider prefix, e.g. gpt-5.5 */
  model: string
  /** Persona / system prompt for the agent. */
  systemPrompt: string
}

/** Per-agent openclaw paths, all under the agent's home. */
export function openclawPaths(home: string): { configPath: string, stateDir: string, workspace: string } {
  return {
    configPath: join(home, '.openclaw', 'openclaw.json'),
    stateDir: join(home, '.openclaw', 'state'),
    workspace: join(home, '.openclaw', 'workspace'),
  }
}

/** Build the openclaw config object (pure — testable). */
export function buildOpenclawConfig(agent: OpenclawAgent, rt: OpenclawRuntime): unknown {
  const { workspace } = openclawPaths(agent.home)
  return {
    models: {
      providers: {
        // openclaw schema: provider.models is an array of {id, api} objects, not
        // bare strings (see `openclaw config schema`). api selects the dialect.
        [PROVIDER]: {
          baseUrl: rt.apiBase,
          apiKey: rt.apiKey,
          api: PROVIDER_API,
          models: GATEWAY_MODELS.map(id => ({ id, name: id, api: PROVIDER_API })),
        },
      },
    },
    agents: {
      // We supply the bootstrap files ourselves — don't let openclaw overwrite
      // them with its defaults. reasoningDefault:off avoids the gateway's
      // tools+reasoning→/responses 404 (task 01KVANKACC6NYHK4VCW09DXYVR).
      defaults: { skipBootstrap: true, reasoningDefault: 'off' },
      list: [{
        id: agent.name,
        default: true,
        name: agent.name,
        workspace,
        model: `${PROVIDER}/${rt.model}`,
        // CLI-as-tool: the agent acts via our CLIs through the shell.
        tools: { allow: ['exec', 'read', 'write'] },
      }],
    },
  }
}

/** Persona/identity bootstrap files openclaw reads from the workspace (pure). */
export function buildWorkspaceFiles(agent: OpenclawAgent, rt: OpenclawRuntime): Record<string, string> {
  const soul = rt.systemPrompt.trim() || `You are ${agent.name}, an OpenApe agent.`
  const agents = [
    `# Operating instructions`,
    ``,
    `You are the agent \`${agent.email}\` (short name: ${agent.name}).`,
    ``,
    `Your tools are the OpenApe CLIs, available in your shell:`,
    `- \`apes\` — your DDISA identity and grants.`,
    `- \`ape-tasks\` — create, list, and update tasks.`,
    `- \`ape-troop\` — read your company/org (goals, members, reports).`,
    ``,
    `These CLIs already act as you — they read your identity from your home.`,
    `Prefer them over guessing. Keep replies concise.`,
  ].join('\n')
  const identity = `# Identity\n\nName: ${agent.name}\nEmail: ${agent.email}\n`
  return { 'SOUL.md': `${soul}\n`, 'AGENTS.md': `${agents}\n`, 'IDENTITY.md': identity }
}

/**
 * Write the openclaw config + workspace bootstrap files into the agent's home.
 * Idempotent — the files are mechanically derived, so re-running overwrites them.
 */
export function prepareOpenclawHome(agent: OpenclawAgent, rt: OpenclawRuntime): void {
  const { configPath, stateDir, workspace } = openclawPaths(agent.home)
  mkdirSync(join(agent.home, '.openclaw'), { recursive: true })
  mkdirSync(stateDir, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  // mode 600 — the config carries the gateway key.
  writeFileSync(configPath, `${JSON.stringify(buildOpenclawConfig(agent, rt), null, 2)}\n`, { mode: 0o600 })
  for (const [file, body] of Object.entries(buildWorkspaceFiles(agent, rt)))
    writeFileSync(join(workspace, file), body, { mode: 0o644 })
  // The nest (root) wrote these; a `sudo -u <agent>` openclaw can't read the
  // mode-600 config (the gateway token) or write session state until they're
  // the agent's. Best-effort: the local/dev path runs openclaw as the nest user
  // (no sudo), where `uid` may not be a real OS user.
  if (agent.uid !== undefined) {
    try { chownTree(join(agent.home, '.openclaw'), agent.uid, agent.uid) }
    catch { /* no such OS user (local/dev) — openclaw runs as the nest user */ }
  }
}

/** Recursively chown a path (file or dir tree) to uid:gid. */
function chownTree(path: string, uid: number, gid: number): void {
  chownSync(path, uid, gid)
  let entries: string[]
  try { entries = readdirSync(path) }
  catch { return } // a file, not a directory
  for (const entry of entries) chownTree(join(path, entry), uid, gid)
}

/** Build the `openclaw agent` invocation for one turn (pure — testable). */
export function buildInvocation(
  agent: OpenclawAgent,
  rt: OpenclawRuntime,
  message: string,
  sessionKey: string,
): { args: string[], env: Record<string, string> } {
  const { configPath, stateDir } = openclawPaths(agent.home)
  return {
    args: [
      'agent',
      '--local',
      '--json',
      '--agent', agent.name,
      '--message', message,
      '--session-key', `agent:${agent.name}:${sessionKey}`,
      '--model', `${PROVIDER}/${rt.model}`,
    ],
    env: {
      HOME: agent.home,
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_STATE_DIR: stateDir,
    },
  }
}

/** Pull the assistant text out of `openclaw agent --json` stdout. */
export function parseReply(stdout: string): string {
  const json = stdout.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return stdout.trim()
  try {
    const obj = JSON.parse(json) as Record<string, unknown>
    // openclaw (2026.6.x) returns { payloads: [{ text, mediaUrl }], meta }.
    if (Array.isArray(obj.payloads)) {
      const text = obj.payloads
        .map(p => (p && typeof p === 'object' ? (p as Record<string, unknown>).text : undefined))
        .filter((t): t is string => typeof t === 'string')
        .join('\n')
        .trim()
      if (text) return text
    }
    // Fallbacks for other versions / shapes.
    const text = obj.reply ?? obj.text ?? obj.message ?? obj.content ?? obj.output
    return typeof text === 'string' ? text.trim() : stdout.trim()
  }
  catch {
    return stdout.trim()
  }
}

export interface OpenclawInvokeDeps {
  /** openclaw binary (default 'openclaw'). */
  bin?: string
  /** Run the invocation as the agent's OS user (container/host sudo). Default off. */
  runAs?: (args: string[], env: Record<string, string>) => Promise<{ stdout: string }>
  timeoutMs?: number
}

/**
 * Run one openclaw turn and return the reply text. By default exec's the
 * `openclaw` binary directly with the per-agent env (suitable for the local /
 * in-process path). Inject `runAs` to drop to the agent uid in production.
 */
export async function invokeOpenclaw(
  agent: OpenclawAgent,
  rt: OpenclawRuntime,
  message: string,
  sessionKey: string,
  deps: OpenclawInvokeDeps = {},
): Promise<string> {
  const { args, env } = buildInvocation(agent, rt, message, sessionKey)
  if (deps.runAs) {
    const { stdout } = await deps.runAs(args, env)
    return parseReply(stdout)
  }
  const { stdout } = await execFileAsync(deps.bin ?? 'openclaw', args, {
    env: { ...process.env, ...env },
    maxBuffer: 4 * 1024 * 1024,
    timeout: deps.timeoutMs ?? 600_000,
  })
  return parseReply(stdout)
}

/**
 * A `runAs` that drops the openclaw exec to the agent's OS user via passwordless
 * `sudo -u` (the container image grants this for nest-managed users, same as the
 * bridge's pm2 path). sudo strips the environment, so the per-agent env
 * (HOME / OPENCLAW_CONFIG_PATH / OPENCLAW_STATE_DIR) is re-applied inside the
 * sudo'd command via `env KEY=VAL …`. openclaw's CLI tool-calls then also run as
 * that user — the isolation the bridge shares.
 */
/** Pure `sudo` argv builder (testable): `-n -u <name> -- env KEY=VAL … <bin> <args>`. */
export function sudoArgv(agentName: string, args: string[], env: Record<string, string>, bin = 'openclaw'): string[] {
  const envPairs = Object.entries(env).map(([k, v]) => `${k}=${v}`)
  return ['-n', '-u', agentName, '--', 'env', ...envPairs, bin, ...args]
}

export function sudoRunAs(agentName: string, bin = 'openclaw'): NonNullable<OpenclawInvokeDeps['runAs']> {
  return async (args, env) => {
    const { stdout } = await execFileAsync('sudo', sudoArgv(agentName, args, env, bin), {
      env: process.env,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 600_000,
    })
    return { stdout }
  }
}
