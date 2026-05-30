// Platform abstraction for host-level ops (identity, agent users,
// supervisor lifecycle, run-as). Currently macOS-only; the Linux impl
// lands in Milestone B alongside `escapes-linux`. Every call site that
// historically reached for `lib/macos-user`, `lib/macos-host`,
// `lib/agent-bootstrap`, `lib/launchd-reconcile`, or `lib/troop-bootstrap`
// should route through `getHostPlatform()` instead.
//
// Selection happens at first call via `process.platform`. Both impls are
// eagerly imported so this module is platform-neutral at compile-time —
// the impls themselves must NOT execute side effects at top level (no
// dscl probes, no plist writes, no `which` calls) so importing the wrong
// one on the wrong host is a no-op.

import process from 'node:process'
import { darwinHostPlatform } from './darwin'
import { linuxHostPlatform } from './linux'

// ---- Types ----------------------------------------------------------------

export interface AgentUserSummary {
  /** OS-level account name (e.g. `openape-agent-coder` on macOS). */
  name: string
  uid: number | null
  shell: string | null
  /** Resolved home directory (macOS NFSHomeDirectory / Linux passwd entry). */
  homeDir: string | null
}

export interface OrphanRecord {
  /** dscl record name / passwd entry. */
  name: string
  uid: number | null
  /** Home directory the record points at — already verified missing. */
  homeDir: string
}

export interface CreateAgentUserSpec {
  agentName: string
  /** Authorized SSH key (ed25519) for the agent's session. */
  sshPublicKey: string
  /** X25519 capability seal pubkey (base64). Optional pre-M2. */
  encryptionPublicKey?: string
  /** True when re-spawning over an existing account (idempotent path). */
  respawn?: boolean
}

export interface DestroyAgentUserSpec {
  agentName: string
  /**
   * Leave the user record as a tombstone instead of deleting it.
   * macOS: forced true under the FDA-less audit-session — `cleanup-orphans`
   * later sweeps from interactive sudo. Linux: ignored; `userdel` succeeds.
   */
  keepTombstone?: boolean
}

export interface BridgeSupervisorSpec {
  agentName: string
  agentUsername: string
  homeDir: string
  /** PATH + OPENAPE_* env vars passed to the ape-agent invocation. */
  env: Record<string, string>
}

export interface SyncSupervisorSpec {
  agentName: string
  agentUsername: string
  homeDir: string
}

export interface NestSupervisorSpec {
  /** User the nest runs as (macOS: `_openape_nest`, Linux: `openape`). */
  user: string
  homeDir: string
  /** UID for launchctl user-domain lookup (macOS only). */
  uid?: number
}

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

// ---- Interface ------------------------------------------------------------

export interface HostPlatform {
  // Identity
  getHostId: () => string
  getHostname: () => string

  // Agent users — read
  /** OS-level account name for an agent (with platform prefix on macOS). */
  agentUsername: (agentName: string) => string
  /** Resolve an agent's OS user record (tries prefixed + bare). Null when missing. */
  lookupAgentUser: (agentName: string) => AgentUserSummary | null
  /** Read by exact OS-level username (no prefix dance). */
  readAgentUser: (osName: string) => AgentUserSummary | null
  /** Raw set of all OS-level user-account names on the host. */
  listAgentUserNames: () => Set<string>
  /** Tombstone records. macOS only; Linux returns []. */
  listOrphanAgentUsers: () => OrphanRecord[]

  // Agent users — lifecycle (privileged)
  createAgentUser: (spec: CreateAgentUserSpec) => Promise<AgentUserSummary>
  destroyAgentUser: (spec: DestroyAgentUserSpec) => Promise<void>

  // Supervisor — per-agent bridge
  installBridgeSupervisor: (spec: BridgeSupervisorSpec) => Promise<void>
  removeBridgeSupervisor: (agentName: string) => Promise<void>
  restartBridgeSupervisor: (agentName: string) => Promise<void>

  // Supervisor — per-agent troop-sync (Linux may collapse this into the bridge unit)
  installSyncSupervisor: (spec: SyncSupervisorSpec) => Promise<void>
  removeSyncSupervisor: (agentName: string) => Promise<void>

  // Supervisor — the nest itself
  installNestSupervisor: (spec: NestSupervisorSpec) => Promise<void>
  uninstallNestSupervisor: (spec: NestSupervisorSpec) => Promise<void>

  // Run-as (sandboxed exec inside an agent's account)
  runAsAgentUser: (agentName: string, argv: string[]) => Promise<ExecResult>
}

// ---- Factory --------------------------------------------------------------

export function isDarwin(): boolean {
  return process.platform === 'darwin'
}

export function isLinux(): boolean {
  return process.platform === 'linux'
}

let testOverride: HostPlatform | null = null

export function getHostPlatform(): HostPlatform {
  if (testOverride) return testOverride
  if (isDarwin()) return darwinHostPlatform
  if (isLinux()) return linuxHostPlatform
  throw new Error(`unsupported host platform: ${process.platform}`)
}

export function __setHostPlatformForTesting(impl: HostPlatform | null): void {
  testOverride = impl
}
