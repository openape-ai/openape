// Pure builder functions for the hatch compose + env bundles.
// Extracted from the handler files so they can be unit-tested without
// Nitro auto-imports (defineEventHandler, useRuntimeConfig).
//
// Subscription-only (M3.4): the nest image runs an in-process Codex proxy on
// its own loopback:4000, so a hatched pod is a SINGLE container — no separate
// litellm/LLM service, no provider API keys. The ChatGPT credential is seeded
// via troop's "Connect ChatGPT" flow once the nest is online.

// OpenAI-compatible base URL the per-agent bridges talk to: the in-nest
// codex-proxy on loopback. (Env name stays LITELLM_* for bridge back-compat;
// the target is the codex-proxy, not litellm.) The API key is a loopback dummy
// — the proxy ignores Authorization and authenticates to OpenAI with the
// seeded ChatGPT credential.
const CODEX_PROXY_BASE_URL = 'http://127.0.0.1:4000/v1'
const CODEX_PROXY_API_KEY = 'sk-codex-loopback'
// Default subscription model served over the Codex Responses backend.
const DEFAULT_BRIDGE_MODEL = 'gpt-5'
// Nest image, pulled from our self-hosted registry on chatty. Anonymous pull,
// so hatched pods need no registry credentials (replaced ghcr.io).
const NEST_IMAGE = 'registry.openape.ai/openape-nest:latest'

/**
 * Build the docker-compose YAML for a BYO nest bundle.
 * Used by POST /api/nest/hatch (operator-provisioned Docker host).
 */
export function buildNestComposeYaml(opts: {
  troopUrl: string
  ownerEmail: string
  hatchToken: string
  generatedAt?: string
}): string {
  const ts = opts.generatedAt ?? new Date().toISOString()
  return `# Generated for ${opts.ownerEmail} on ${ts}.
# Run on the target host:
#   docker compose up -d
# Then verify on this troop instance — the host appears in
# /api/nest/hosts within ~5s of bootup.
#
# Subscription-only: the nest runs an in-process Codex proxy on its own
# loopback:4000 — no separate LLM container. The ChatGPT credential is
# seeded via troop's "Connect ChatGPT" flow after the nest is online.

services:
  openape-nest:
    image: ${NEST_IMAGE}
    container_name: openape-nest
    restart: unless-stopped
    networks: [openape-pod]
    ports: ["127.0.0.1:9091:9091"]
    volumes:
      - openape-nest-data:/var/lib/openape/nest
      - openape-homes:/var/lib/openape/homes
    environment:
      OPENAPE_NEST_PORT: "9091"
      OPENAPE_TROOP_URL: ${opts.troopUrl}
      OPENAPE_HATCH_TOKEN: ${opts.hatchToken}
      OPENAPE_HATCH_OWNER: ${opts.ownerEmail}
      OPENAPE_BRIDGE_TARGET: troop
      LITELLM_BASE_URL: ${CODEX_PROXY_BASE_URL}
      LITELLM_API_KEY: ${CODEX_PROXY_API_KEY}
      APE_CHAT_BRIDGE_MODEL: \${APE_CHAT_BRIDGE_MODEL:-${DEFAULT_BRIDGE_MODEL}}

volumes:
  openape-nest-data:
  openape-homes:
networks:
  openape-pod:
    driver: bridge
`
}

/**
 * Build the docker-compose YAML for a cloud-provisioned pod bundle.
 * Used by POST /api/pod/hatch (Exoscale and future cloud providers).
 */
export function buildPodComposeYaml(opts: { troopUrl: string, ownerEmail: string, hatchToken: string }): string {
  return `services:
  openape-nest:
    image: ${NEST_IMAGE}
    container_name: openape-nest
    restart: unless-stopped
    networks: [openape-pod]
    ports: ["127.0.0.1:9091:9091"]
    volumes:
      - openape-nest-data:/var/lib/openape/nest
      - openape-homes:/var/lib/openape/homes
    environment:
      OPENAPE_NEST_PORT: "9091"
      OPENAPE_TROOP_URL: ${opts.troopUrl}
      OPENAPE_HATCH_TOKEN: ${opts.hatchToken}
      OPENAPE_HATCH_OWNER: ${opts.ownerEmail}
      OPENAPE_BRIDGE_TARGET: troop
      LITELLM_BASE_URL: ${CODEX_PROXY_BASE_URL}
      LITELLM_API_KEY: ${CODEX_PROXY_API_KEY}
      APE_CHAT_BRIDGE_MODEL: \${APE_CHAT_BRIDGE_MODEL:-${DEFAULT_BRIDGE_MODEL}}

volumes:
  openape-nest-data:
  openape-homes:
networks:
  openape-pod:
    driver: bridge
`
}

/**
 * Build the .env file for a pod bundle. Subscription-only: the model is the
 * only knob — no provider API keys (agents run on the ChatGPT subscription via
 * the in-nest codex-proxy). OPENAPE_* vars belong in the compose environment:
 * block (not .env) so they can't be accidentally overridden.
 */
export function buildPodEnvFile(secrets: Record<string, string>): string {
  return `APE_CHAT_BRIDGE_MODEL=${secrets.APE_CHAT_BRIDGE_MODEL ?? DEFAULT_BRIDGE_MODEL}\n`
}

/**
 * Build the .env file for the BYO nest bundle. Subscription-only — the only
 * knob is the model; override it before `docker compose up` if you like.
 */
export function buildNestEnvFile(): string {
  return `# Copy to .env next to docker-compose.yml. Override the model if you like.
APE_CHAT_BRIDGE_MODEL=${DEFAULT_BRIDGE_MODEL}
`
}
