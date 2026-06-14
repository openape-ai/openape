// Side-effect-free bridge config: the `BridgeConfig` shape, its defaults, and
// the env parsing. Kept out of `bridge.ts` because that module runs `main()` at
// import — re-exporting a *value* from it (for the nest's in-process runtime)
// would drag the bin's startup into any importer. This module has no top-level
// effects, so the library entrypoint can re-export `readConfig` safely.

const DEFAULT_ENDPOINT = 'https://troop.openape.ai'
const DEFAULT_APES_BIN = 'apes'
const DEFAULT_MAX_STEPS = 10
const DEFAULT_SYSTEM_PROMPT
  = 'You are a helpful assistant in a 1:1 chat. Be concise and friendly. '
    + 'When asked for facts, say "I don\'t know" rather than guess.'

export interface BridgeConfig {
  endpoint: string
  apesBin: string
  model: string
  systemPrompt: string
  tools: string[]
  maxSteps: number
  roomFilter?: string
}

/**
 * Resolve the bridge config from an env map. Defaults to `process.env` so the
 * bin entrypoint is unchanged; the env is injectable so the nest's in-process
 * SessionHost can resolve one config per agent (per-agent model merged into the
 * map) without depending on or mutating the daemon's global `process.env`.
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const toolsRaw = env.APE_CHAT_BRIDGE_TOOLS ?? ''
  const tools = toolsRaw.split(',').map(s => s.trim()).filter(Boolean)
  const maxStepsRaw = env.APE_CHAT_BRIDGE_MAX_STEPS
  const maxSteps = maxStepsRaw ? Number.parseInt(maxStepsRaw, 10) : DEFAULT_MAX_STEPS

  // Model is required — there's no safe built-in default. A wrong
  // default silently routes to a model the user's LiteLLM proxy
  // doesn't know about and 400s every chat-completion request,
  // visible only as a runtime error in the chat UI. Failing at
  // startup with a pointer to the fix is much friendlier.
  const model = env.APE_CHAT_BRIDGE_MODEL
  if (!model) {
    throw new Error(
      'APE_CHAT_BRIDGE_MODEL is not set. Set it in the container env '
      + '(compose environment: block) or globally in `~/litellm/.env`. '
      + 'Common values: `gpt-5.4` (ChatGPT-only LiteLLM proxy), `claude-haiku-4-5` (Anthropic-only).',
    )
  }

  return {
    endpoint: (env.OPENAPE_TROOP_URL ?? DEFAULT_ENDPOINT).replace(/\/$/, ''),
    apesBin: env.APE_CHAT_BRIDGE_APES_BIN ?? DEFAULT_APES_BIN,
    model,
    systemPrompt: env.APE_CHAT_BRIDGE_SYSTEM_PROMPT ?? DEFAULT_SYSTEM_PROMPT,
    tools,
    maxSteps: Number.isFinite(maxSteps) && maxSteps > 0 ? maxSteps : DEFAULT_MAX_STEPS,
    roomFilter: env.APE_CHAT_BRIDGE_ROOM,
  }
}
