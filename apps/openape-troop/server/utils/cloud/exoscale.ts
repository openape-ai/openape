// Exoscale cloud adapter — the first concrete CloudProvider.
//
// Why Exoscale: EU-Swiss provider with a clean API (Compute API v2,
// OpenAPI-typed), ed25519 SSH key support, and instance-template
// IDs that don't rotate every few months. Plays nicely with EU/CH
// data residency for the OpenApe-managed agent fleet.
//
// Auth: EXOSCALE_API_KEY + EXOSCALE_API_SECRET — read from env when
// the adapter methods are called (not at import time, so the module
// is safe to import without credentials available).
//
// Status:
//   - This is the SCAFFOLDED form. The Exoscale Compute v2 API client
//     wiring (signed-URL requests + retry/back-off) lives behind the
//     `callExoscale` helper which currently throws "not yet wired".
//     PR #496 stack will land that helper; this file establishes the
//     adapter shape + cloud-init bootstrap flow so the rest of the
//     hatch pipeline can compile + test against it.

import { registerCloud      } from './index'
import type { BootstrapPodInput, CloudAdapter, CreateInstanceSpec, InstanceInfo, InstanceRef } from './index'

const PROVIDER_ID = 'exoscale'
const DEFAULT_API_BASE = 'https://api-ch-gva-2.exoscale.com/v2'

interface ExoscaleEnv {
  apiKey: string
  apiSecret: string
  apiBase: string
}

function readEnv(): ExoscaleEnv {
  const apiKey = process.env.EXOSCALE_API_KEY
  const apiSecret = process.env.EXOSCALE_API_SECRET
  if (!apiKey || !apiSecret) {
    throw new Error('EXOSCALE_API_KEY and EXOSCALE_API_SECRET must be set in the environment')
  }
  return {
    apiKey,
    apiSecret,
    apiBase: process.env.EXOSCALE_API_BASE || DEFAULT_API_BASE,
  }
}

/**
 * Build the cloud-init user-data that bootstraps a hatched OpenApe pod
 * on first boot. The sequence:
 *   1. apt update + install docker + docker compose plugin
 *   2. drop the operator's ssh key into /root/.ssh/authorized_keys
 *   3. write /opt/openape/docker-compose.yml + .env + litellm.yaml from
 *      the hatch bundle (passed in as inline base64 to keep the cloud-
 *      init manifest self-contained; no follow-up scp needed)
 *   4. docker compose up -d
 *
 * The bundle is the same one POST /api/nest/hatch returns — the cloud
 * adapter is a thin wrapper around "do the same thing the BYO operator
 * would do, but on a freshly-booted VM".
 */
export function buildExoscaleUserData(input: {
  sshPublicKey: string
  composeYaml: string
  envFile: string
  litellmYaml: string
}): string {
  const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')
  return `#cloud-config
package_update: true
packages:
  - ca-certificates
  - curl
  - gnupg

runcmd:
  # Install Docker Engine + the compose plugin via the official apt repo.
  - install -m 0755 -d /etc/apt/keyrings
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  - chmod a+r /etc/apt/keyrings/docker.gpg
  - echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
  - apt-get update
  - DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  - systemctl enable --now docker
  # Materialize the OpenApe pod from base64-inlined hatch bundle.
  - mkdir -p /opt/openape
  - echo "${b64(input.composeYaml)}" | base64 -d > /opt/openape/docker-compose.yml
  - echo "${b64(input.envFile)}"     | base64 -d > /opt/openape/.env
  - echo "${b64(input.litellmYaml)}" | base64 -d > /opt/openape/litellm.yaml
  - chmod 600 /opt/openape/.env
  - (cd /opt/openape && docker compose up -d)

ssh_authorized_keys:
  - ${input.sshPublicKey}
`
}

// Placeholder API-call helper. Replaced with a signed-URL implementation
// (Exoscale v2 HMAC scheme) when the Exoscale SDK lands.
async function callExoscale<T>(_env: ExoscaleEnv, _verb: 'GET' | 'POST' | 'DELETE', _path: string, _body?: unknown): Promise<T> {
  throw new Error('exoscale.callExoscale is a scaffold — wire the signed-URL HTTP client (PR follow-up).')
}

export const exoscaleAdapter: CloudAdapter = {
  id: PROVIDER_ID,
  displayName: 'Exoscale (CH/EU)',

  async createInstance(spec: CreateInstanceSpec): Promise<InstanceRef> {
    const env = readEnv()
    // POST /v2/instance — body shape per
    // https://openapi-v2.exoscale.com/#operation/create-instance.
    const res = await callExoscale<{ id: string }>(env, 'POST', `/instance?zone=${encodeURIComponent(spec.region)}`, {
      name: spec.name,
      'instance-type': { name: spec.instanceType },
      template: { id: spec.image },
      'ssh-key': { name: 'openape-hatch' },
      'user-data': spec.userData,
      labels: spec.tags,
    })
    return { provider: PROVIDER_ID, id: res.id, region: spec.region }
  },

  async destroyInstance(ref: InstanceRef): Promise<void> {
    if (ref.provider !== PROVIDER_ID) {
      throw new Error(`exoscale.destroyInstance called on a ${ref.provider} ref`)
    }
    const env = readEnv()
    try {
      await callExoscale(env, 'DELETE', `/instance/${encodeURIComponent(ref.id)}?zone=${encodeURIComponent(ref.region)}`)
    }
    catch (err) {
      // 404 = already terminated → idempotent success.
      if (err instanceof Error && /404|not.?found/i.test(err.message)) return
      throw err
    }
  },

  async getInstance(ref: InstanceRef): Promise<InstanceInfo> {
    const env = readEnv()
    const v = await callExoscale<{
      state: string
      'public-ip'?: string
      'public-ipv6'?: string
      'created-at'?: string
    }>(env, 'GET', `/instance/${encodeURIComponent(ref.id)}?zone=${encodeURIComponent(ref.region)}`)
    return {
      ref,
      state: mapExoscaleState(v.state),
      ipv4: v['public-ip'],
      ipv6: v['public-ipv6'],
      createdAt: v['created-at'] ? Date.parse(v['created-at']) / 1000 : undefined,
    }
  },

  async bootstrapPod(_input: BootstrapPodInput): Promise<void> {
    // With cloud-init, the bootstrap happens *inside* createInstance via
    // the user-data we baked. So bootstrapPod is a no-op for Exoscale —
    // kept on the interface so adapters that DON'T support cloud-init
    // (e.g. bare-metal Hetzner Auction) can fall back to scp+docker.
  },

  publicAddress(info: InstanceInfo): string | null {
    return info.ipv4 ?? info.ipv6 ?? null
  },
}

function mapExoscaleState(s: string): InstanceInfo['state'] {
  switch (s) {
    case 'starting':
    case 'migrating':
      return 'provisioning'
    case 'running':
      return 'running'
    case 'stopped':
    case 'stopping':
      return 'stopped'
    case 'destroyed':
    case 'expunging':
      return 'terminated'
    default:
      return 'error'
  }
}

// Auto-register on import. Consumers do `import '@openape/apes/lib/cloud/exoscale'`
// (side-effect import) to get the adapter into the registry.
registerCloud(exoscaleAdapter)
