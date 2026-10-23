import { release } from 'node:os'

/**
 * Pod execution relies on the custom sandbox-exec profile and native process supervision, whose behaviour can change
 * with any kernel. Execution is therefore enabled only for exact Darwin kernels on Apple silicon that passed the packaged
 * boundary acceptance (README, "Build artifacts and release gates"). Add an entry only with that recorded evidence; a
 * newer kernel, also from a patch update, stays blocked until it has its own entry. Sign-in, diagnosis and updates do
 * not depend on this list.
 */
export const verifiedRuntimes = [
  { kernel: '25.6.0', system: '26.6.2', evidence: 'Pilot kernel since ce6edb77 (September 13, 2026), verified locally on macOS 26.6.2 (25G83); its distribution review stayed pending' },
  { kernel: '27.0.0', system: '27.0.1', evidence: 'Packaged boundary acceptance on macOS 27.0.1 (26A434), October 23, 2026: complete native suite of the unsigned fixture package' },
] as const

export interface ExecutionSupport {
  supported: boolean
  /** verified: listed kernel; unverified: Apple silicon macOS without acceptance yet; incompatible: never executes Pods. */
  compatibility: 'verified' | 'unverified' | 'incompatible'
  platform: string
  architecture: string
  kernel: string
  /** Verified kernels with their macOS version, for diagnosis. */
  verified: string[]
  /** Why execution is blocked; null when supported. */
  reason: string | null
}

export function executionSupport(platform: string = process.platform, architecture: string = process.arch, kernel = release()): ExecutionSupport {
  const verified = verifiedRuntimes.map(runtime => `Darwin ${runtime.kernel} (macOS ${runtime.system})`)
  if (platform !== 'darwin' || architecture !== 'arm64') return { supported: false, compatibility: 'incompatible', platform, architecture, kernel, verified, reason: `Pod execution is not available on ${platform} ${kernel} (${architecture}): Pods executes only on Apple silicon Macs` }
  const supported = verifiedRuntimes.some(runtime => runtime.kernel === kernel)
  return { supported, compatibility: supported ? 'verified' : 'unverified', platform, architecture, kernel, verified, reason: supported ? null : `Pod execution is blocked on ${platform} ${kernel} (${architecture}): only Apple silicon with a verified Darwin kernel (${verified.join(', ')}) passed the packaged sandbox boundary acceptance` }
}

/** Fails closed before any sandboxed Pod process starts on an unverified system. */
export function assertExecutionSupported(support = executionSupport()): void {
  if (!support.supported) throw new Error(support.reason ?? 'Pod execution is blocked on this system')
}
