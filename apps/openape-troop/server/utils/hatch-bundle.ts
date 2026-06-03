import { randomBytes } from 'node:crypto'

// Pure builder functions for the hatch compose + env bundles.
// Extracted from the handler files so they can be unit-tested without
// Nitro auto-imports (defineEventHandler, useRuntimeConfig).

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

services:
  openape-llm:
    image: ghcr.io/openape-ai/openape-llm:latest
    container_name: openape-llm
    restart: unless-stopped
    networks: [openape-pod]
    ports: ["127.0.0.1:4000:4000"]
    volumes: ["./litellm.yaml:/etc/litellm/config.yaml:ro"]
    environment:
      LITELLM_MASTER_KEY: \${LITELLM_MASTER_KEY}
      ANTHROPIC_API_KEY: \${ANTHROPIC_API_KEY}
      CHATGPT_OAUTH_TOKEN: \${CHATGPT_OAUTH_TOKEN}

  openape-nest:
    image: ghcr.io/openape-ai/openape-nest:latest
    container_name: openape-nest
    restart: unless-stopped
    depends_on: [openape-llm]
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
      LITELLM_BASE_URL: http://openape-llm:4000/v1
      LITELLM_API_KEY: \${LITELLM_MASTER_KEY}
      APE_CHAT_BRIDGE_MODEL: \${APE_CHAT_BRIDGE_MODEL:-claude-haiku-4-5}

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
  openape-llm:
    image: ghcr.io/openape-ai/openape-llm:latest
    container_name: openape-llm
    restart: unless-stopped
    networks: [openape-pod]
    ports: ["127.0.0.1:4000:4000"]
    volumes: ["./litellm.yaml:/etc/litellm/config.yaml:ro"]
    environment:
      LITELLM_MASTER_KEY: \${LITELLM_MASTER_KEY}
      ANTHROPIC_API_KEY: \${ANTHROPIC_API_KEY}
      CHATGPT_OAUTH_TOKEN: \${CHATGPT_OAUTH_TOKEN}

  openape-nest:
    image: ghcr.io/openape-ai/openape-nest:latest
    container_name: openape-nest
    restart: unless-stopped
    depends_on: [openape-llm]
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
      LITELLM_BASE_URL: http://openape-llm:4000/v1
      LITELLM_API_KEY: \${LITELLM_MASTER_KEY}

volumes:
  openape-nest-data:
  openape-homes:
networks:
  openape-pod:
    driver: bridge
`
}

/**
 * Build the .env file for a pod bundle. Provider API keys are
 * injected here; OPENAPE_* vars belong in the compose environment:
 * block (not .env) so they can't be accidentally overridden.
 */
export function buildPodEnvFile(secrets: Record<string, string>): string {
  const lines = [
    `LITELLM_MASTER_KEY=sk-litellm-${randomBytes(8).toString('hex')}`,
    `ANTHROPIC_API_KEY=${secrets.ANTHROPIC_API_KEY ?? ''}`,
    `CHATGPT_OAUTH_TOKEN=${secrets.CHATGPT_OAUTH_TOKEN ?? ''}`,
    `APE_CHAT_BRIDGE_MODEL=${secrets.APE_CHAT_BRIDGE_MODEL ?? 'claude-haiku-4-5'}`,
  ]
  return `${lines.join('\n')}\n`
}

/**
 * Build the .env file for the BYO nest bundle. Intentionally minimal —
 * provider keys that vary per operator are placeholders to fill in.
 */
export function buildNestEnvFile(): string {
  return `# Copy to .env next to docker-compose.yml. Fill in provider keys.
LITELLM_MASTER_KEY=sk-litellm-${randomBytes(8).toString('hex')}
ANTHROPIC_API_KEY=
CHATGPT_OAUTH_TOKEN=
APE_CHAT_BRIDGE_MODEL=claude-haiku-4-5
`
}
