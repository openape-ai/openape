import { getAuthorizedBearer } from '@openape/cli-auth'

export type ExchangeFn = (opts: { endpoint: string, aud: string }) => Promise<string>

/**
 * Resolve the LLM key for one turn. When the gateway is llms.openape.ai,
 * exchange this agent's own DDISA token (cli-auth caches + auto-refreshes,
 * so this is cheap once warm); for any other base — e.g. the loopback
 * codex-proxy — the static env key stands. Any exchange error returns
 * `fallback` so a flaky exchange never takes the agent offline.
 */
export async function resolveLlmGatewayKey(
  base: string,
  fallback: string,
  log: (line: string) => void,
  exchange: ExchangeFn = getAuthorizedBearer,
): Promise<string> {
  if (!base.includes('llms.openape.ai'))
    return fallback
  try {
    const u = new URL(base)
    const bearer = await exchange({ endpoint: u.origin, aud: u.host })
    return bearer.replace(/^Bearer\s+/i, '')
  }
  catch (err) {
    log(`llm gateway token exchange failed (keeping current key): ${err instanceof Error ? err.message : String(err)}`)
    return fallback
  }
}
