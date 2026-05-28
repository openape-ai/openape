import { randomBytes } from 'node:crypto'
import { requireOwner } from '../../utils/auth'
import { getCloud } from '../../utils/cloud/index'
import { buildExoscaleUserData } from '../../utils/cloud/exoscale'
import { rememberHatchToken } from '../../utils/hatch-tokens'

// POST /api/pod/hatch — provision a fresh OpenApe pod on a cloud
// provider, with the hatch bundle inlined as cloud-init user-data. The
// nest comes online + connects back to this troop within ~90s of the
// API call returning (depends on provider boot time).
//
// Composition:
//   1. mint a one-time hatch token (same pool as POST /api/nest/hatch)
//   2. assemble the compose bundle (same shape as the BYO path)
//   3. build provider user-data (cloud-init)
//   4. call cloud.createInstance({…, userData})
//   5. return the InstanceRef so the UI can poll for "running"
//
// Auth: troop's owner. Provider credentials are read from the troop
// host's env — NOT proxied through the API. This is intentional: the
// hatch flow runs *as* the operator's cloud account, not as a tenant of
// some hosted-cloud-via-troop service. (Hosted hatching is a future
// option; the same endpoint with a `--via=openape-hosted` flag.)

interface HatchPodBody {
  provider: string
  region: string
  instance_type: string
  image: string
  ssh_public_key: string
  // The same litellm config the operator would mount locally. Passed
  // through verbatim so the hatched pod has identical model routing to
  // the operator's dev environment.
  litellm_yaml: string
  // Provider API keys this pod needs (anthropic, chatgpt-oauth, …).
  // The endpoint embeds them into the .env bundle; they never persist
  // server-side beyond the cloud-init userdata blob.
  llm_secrets: Record<string, string>
}

interface HatchPodResponse {
  instance: { provider: string, id: string, region: string }
  enrollment_token: string
  // Public address may not be known yet at creation time (provisioning).
  // Caller polls GET /api/pod/<provider>/<id> for the IP + state.
}

export default defineEventHandler<Promise<HatchPodResponse>>(async (event) => {
  const ownerEmail = await requireOwner(event)
  const body = await readBody<HatchPodBody>(event)

  // Side-effect import to register the requested provider. Only
  // exoscale ships today; future adapters slot in here.
  if (body.provider === 'exoscale') {
    await import('../../utils/cloud/exoscale')
  }
  else {
    throw createError({ statusCode: 400, statusMessage: `unsupported cloud provider: ${body.provider}` })
  }
  const cloud = getCloud(body.provider)

  // Hatch token + bundle assembly (same shape as the BYO path).
  const token = `nest-hatch-${randomBytes(24).toString('base64url')}`
  const expiresAt = Math.floor(Date.now() / 1000) + 600
  rememberHatchToken({ token, ownerEmail, expiresAt })

  const troopUrl = (useRuntimeConfig().troopUrl as string | undefined) ?? 'https://troop.openape.ai'
  const composeYaml = buildComposeYaml({ troopUrl, ownerEmail, hatchToken: token })
  const envFile = buildEnvFile(body.llm_secrets)

  // Cloud-init user-data — the provider boots the VM, installs Docker,
  // materializes the bundle, runs `docker compose up -d`. ~90s to ready
  // on Exoscale standard.small.
  const userData = buildExoscaleUserData({
    sshPublicKey: body.ssh_public_key,
    composeYaml,
    envFile,
    litellmYaml: body.litellm_yaml,
  })

  const ref = await cloud.createInstance({
    name: `openape-pod-${randomBytes(4).toString('hex')}`,
    region: body.region,
    instanceType: body.instance_type,
    image: body.image,
    sshPublicKey: body.ssh_public_key,
    userData,
    tags: { owner: ownerEmail, role: 'openape-pod' },
  })

  return {
    instance: { provider: ref.provider, id: ref.id, region: ref.region },
    enrollment_token: token,
  }
})

function buildComposeYaml(opts: { troopUrl: string, ownerEmail: string, hatchToken: string }): string {
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

function buildEnvFile(secrets: Record<string, string>): string {
  const lines = [
    `LITELLM_MASTER_KEY=sk-litellm-${randomBytes(8).toString('hex')}`,
    `ANTHROPIC_API_KEY=${secrets.ANTHROPIC_API_KEY ?? ''}`,
    `CHATGPT_OAUTH_TOKEN=${secrets.CHATGPT_OAUTH_TOKEN ?? ''}`,
    `APE_CHAT_BRIDGE_MODEL=${secrets.APE_CHAT_BRIDGE_MODEL ?? 'claude-haiku-4-5'}`,
  ]
  return `${lines.join('\n')}\n`
}
