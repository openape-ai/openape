import { randomBytes } from 'node:crypto'
import { requireOwner } from '../../utils/auth'
import { rememberHatchToken } from '../../utils/hatch-tokens'

// POST /api/nest/hatch — return everything a new operator host (or a
// hatched cloud VM) needs to come online as a nest under this owner.
//
// Response shape is a self-contained bundle: the docker-compose snippet,
// the .env values pre-seeded with the owner's troop SP URL + a freshly-
// minted enrollment token. The host runs:
//
//   curl -sS -X POST -H "Authorization: Bearer ..." troop.openape.ai/api/nest/hatch \
//     | jq -r .compose_yaml > docker-compose.yml
//   curl -sS ...                                       | jq -r .env_file > .env
//   docker compose up -d
//
// The enrollment token is short-lived (TTL 10 min) and single-use; the
// nest exchanges it on first WebSocket connect for a permanent agent
// identity scoped to the owner. Tokens that expire unredeemed are
// garbage-collected by the periodic cleanup.
//
// Cloud-provider adapters (Milestone H/I) call this internally before
// they boot a VM, then `scp` the resulting bundle to the new instance.

interface HatchResponse {
  enrollment_token: string
  expires_at: number
  compose_yaml: string
  env_file: string
}

export default defineEventHandler<Promise<HatchResponse>>(async (event) => {
  const ownerEmail = await requireOwner(event)
  const token = `nest-hatch-${randomBytes(24).toString('base64url')}`
  const expiresAt = Math.floor(Date.now() / 1000) + 600

  // The token lands in the same nest-hatch-tokens table the WS handler
  // checks on first connect. (Storage layer added in the same PR as
  // this endpoint — see server/utils/hatch-tokens.ts.)
  rememberHatchToken({ token, ownerEmail, expiresAt })

  const troopUrl = (useRuntimeConfig().troopUrl as string | undefined) ?? 'https://troop.openape.ai'

  const composeYaml = `# Generated for ${ownerEmail} on ${new Date().toISOString()}.
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
      OPENAPE_TROOP_URL: ${troopUrl}
      OPENAPE_HATCH_TOKEN: ${token}
      OPENAPE_HATCH_OWNER: ${ownerEmail}
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

  const envFile = `# Copy to .env next to docker-compose.yml. Fill in provider keys.
LITELLM_MASTER_KEY=sk-litellm-${randomBytes(8).toString('hex')}
ANTHROPIC_API_KEY=
CHATGPT_OAUTH_TOKEN=
APE_CHAT_BRIDGE_MODEL=claude-haiku-4-5
`

  return {
    enrollment_token: token,
    expires_at: expiresAt,
    compose_yaml: composeYaml,
    env_file: envFile,
  }
})
