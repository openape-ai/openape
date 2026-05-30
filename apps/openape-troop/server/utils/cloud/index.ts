// CloudProvider adapter — mirrors the ForgeAdapter pattern at
// packages/apes/src/lib/coding/forge.ts. One adapter knows how to
// hatch + supervise OpenApe pods on a specific IaaS (Exoscale, Hetzner,
// AWS, Linode, …). Recipes / orchestrators consume `getCloud(id)` and
// stay provider-agnostic; switching IaaS is one config flip.
//
// What an adapter does:
//   - createInstance(spec)  — provision a VM, return its instance ref
//   - destroyInstance(ref)  — tear down (idempotent — destroy of
//                              already-gone instance is a no-op success)
//   - getInstance(ref)      — current state (provisioning | running |
//                              stopped | terminated | error)
//   - bootstrapPod(ref, …)  — once running, scp the compose bundle +
//                              docker compose up. Pure orchestration —
//                              the actual provisioning is upstream.
//   - publicAddress(ref)    — IPv4 / IPv6 / hostname for SSH + HTTP.
//
// All adapters must be side-effect-free at module load (no network
// calls during import). Construct lazily inside the methods.

export type InstanceState =
  | 'provisioning'
  | 'running'
  | 'stopped'
  | 'terminated'
  | 'error'

export interface InstanceRef {
  /** Adapter that owns this instance (matches CloudAdapter.id). */
  provider: string
  /** Provider-native instance ID — for joins against the IaaS API. */
  id: string
  /** Region/zone the instance lives in. */
  region: string
}

export interface CreateInstanceSpec {
  /** Display name. Most providers accept lower-case alphanumerics + dashes. */
  name: string
  /** Region/zone — provider-native value (e.g. 'ch-gva-2' for Exoscale GVA-2). */
  region: string
  /** Instance type — provider-native sku (e.g. 'standard.small'). */
  instanceType: string
  /** Image — provider-native template ID; should be an Ubuntu/Debian-class image. */
  image: string
  /** Authorized SSH key for the operator (or troop's deploy key). */
  sshPublicKey: string
  /** Optional cloud-init user-data — for early-boot package install + docker-compose start. */
  userData?: string
  /** Free-form tags the provider supports (key=value). */
  tags?: Record<string, string>
}

export interface InstanceInfo {
  ref: InstanceRef
  state: InstanceState
  ipv4?: string
  ipv6?: string
  /** Human-readable diagnostic when state === 'error'. */
  errorMessage?: string
  createdAt?: number
}

export interface BootstrapPodInput {
  ref: InstanceRef
  /** docker-compose.yml content (from POST /api/nest/hatch). */
  composeYaml: string
  /** .env content (LiteLLM master key, API keys). */
  envFile: string
  /** litellm config yaml content. */
  litellmYaml: string
  /** SSH private key path (operator-side) for connecting to the new VM. */
  sshKeyPath: string
}

export interface CloudAdapter {
  id: string
  /** Optional human-readable label for picker UIs. */
  displayName?: string
  createInstance: (spec: CreateInstanceSpec) => Promise<InstanceRef>
  destroyInstance: (ref: InstanceRef) => Promise<void>
  getInstance: (ref: InstanceRef) => Promise<InstanceInfo>
  bootstrapPod: (input: BootstrapPodInput) => Promise<void>
  publicAddress: (info: InstanceInfo) => string | null
}

const registry = new Map<string, CloudAdapter>()

export function registerCloud(adapter: CloudAdapter): void {
  registry.set(adapter.id, adapter)
}

export function getCloud(id: string): CloudAdapter {
  const a = registry.get(id)
  if (!a) {
    throw new Error(`cloud adapter "${id}" is not registered. Known: ${[...registry.keys()].join(', ') || '(none)'}`)
  }
  return a
}

export function listClouds(): string[] {
  return [...registry.keys()]
}
