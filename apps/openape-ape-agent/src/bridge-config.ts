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

const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const
export type ReasoningEffort = typeof REASONING_EFFORTS[number]

/**
 * Telegram chat-adapter config. Present only when the owner has bound a bot
 * token to this agent (delivered as a sealed secret → bridge env). Its mere
 * presence activates the Telegram channel — no separate toggle.
 */
export interface TelegramConfig {
  botToken: string
  /** The one Telegram user id allowed to drive the bot. */
  ownerUserId: number
}

export interface BridgeConfig {
  endpoint: string
  apesBin: string
  model: string
  /**
   * Reasoning/thinking depth for gpt-5.x. Lets the PM tier compute by task
   * difficulty without changing the model. Omitted = proxy/model default.
   */
  reasoningEffort?: ReasoningEffort
  systemPrompt: string
  tools: string[]
  maxSteps: number
  roomFilter?: string
  /** Optional Telegram adapter — set when TELEGRAM_BOT_TOKEN is in the env. */
  telegram?: TelegramConfig
}

/**
 * Read the optional Telegram adapter config. Activation is by secret-presence:
 * `TELEGRAM_BOT_TOKEN` present → adapter on. We hard-fail if the owner lock
 * (`TELEGRAM_OWNER_USER_ID`) is missing or non-numeric so an open, unlocked bot
 * can never start by accident.
 */
function readTelegramConfig(env: NodeJS.ProcessEnv): TelegramConfig | undefined {
  const botToken = env.TELEGRAM_BOT_TOKEN
  if (!botToken) return undefined
  const ownerUserId = Number.parseInt(env.TELEGRAM_OWNER_USER_ID ?? '', 10)
  if (!Number.isInteger(ownerUserId)) {
    throw new TypeError(
      'TELEGRAM_BOT_TOKEN is set but TELEGRAM_OWNER_USER_ID is missing or not a number. '
      + 'The Telegram adapter must be locked to exactly one Telegram user id.',
    )
  }
  return { botToken, ownerUserId }
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

  // Optional reasoning depth; ignore an unknown value rather than 400 every turn.
  const effortRaw = env.APE_CHAT_BRIDGE_REASONING_EFFORT
  const reasoningEffort = REASONING_EFFORTS.includes(effortRaw as ReasoningEffort)
    ? (effortRaw as ReasoningEffort)
    : undefined

  return {
    endpoint: (env.OPENAPE_TROOP_URL ?? DEFAULT_ENDPOINT).replace(/\/$/, ''),
    apesBin: env.APE_CHAT_BRIDGE_APES_BIN ?? DEFAULT_APES_BIN,
    model,
    reasoningEffort,
    systemPrompt: env.APE_CHAT_BRIDGE_SYSTEM_PROMPT ?? DEFAULT_SYSTEM_PROMPT,
    tools,
    maxSteps: Number.isFinite(maxSteps) && maxSteps > 0 ? maxSteps : DEFAULT_MAX_STEPS,
    roomFilter: env.APE_CHAT_BRIDGE_ROOM,
    telegram: readTelegramConfig(env),
  }
}
