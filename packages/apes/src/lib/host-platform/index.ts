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

export interface NestSupervisorSpec {
  /** Absolute path to the `openape-nest` binary. */
  nestBin: string
  /** Absolute path to the `apes` binary (passed via env to subprocesses). */
  apesBin: string
  /** Human user's home directory (where launchd writes the per-user agent). */
  userHome: string
  /** The nest's own data dir — becomes `HOME` for the daemon process. */
  nestHome: string
  /** HTTP port the nest API listens on. */
  port: number
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

  // Supervisor — the host-local nest itself
  installNestSupervisor: (spec: NestSupervisorSpec) => Promise<void>
  uninstallNestSupervisor: () => Promise<void>

  // Privileged execution boundary (root + per-agent-user). On macOS these
  // route through `apes run --as <user> --wait`; on Linux they map to
  // sudo/userspec inside the container or namespaced exec on the host.
  // Per-agent createAgentUser / destroyAgentUser stay in commands/agents/*
  // as orchestration; they shell into `runPrivilegedBash` with the
  // already-built script. This keeps the interface a thin OS-escalation
  // boundary rather than a sprawling user-lifecycle facade.
  runPrivilegedBash: (script: string) => Promise<void>
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
