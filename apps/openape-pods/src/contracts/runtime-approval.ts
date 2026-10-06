export interface RuntimeApprovalPreference { enabled: boolean }
export interface RuntimeApprovalBinding { runtimeId: string, issuer: string, subject: string, account: string }
export interface RuntimeApprovalView extends RuntimeApprovalPreference { standing: boolean, owner: string | null, scope: string | null }
export type RuntimeApprovalCommand = { type: 'get' | 'manage' } | { type: 'set', enabled: boolean } | { type: 'setStanding', enabled: boolean, scope: string | null }

export function parseRuntimeApprovalPreference(value: unknown): RuntimeApprovalPreference {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || typeof (value as RuntimeApprovalPreference).enabled !== 'boolean') throw new Error('Invalid runtime approval preference')
  return { enabled: (value as RuntimeApprovalPreference).enabled }
}

export function parseRuntimeApprovalCommand(value: unknown): RuntimeApprovalCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid runtime approval command')
  const { type, ...rest } = value as Record<string, unknown>
  if ((type === 'get' || type === 'manage') && Object.keys(rest).length === 0) return { type }
  if (type === 'set') return { type, ...parseRuntimeApprovalPreference(rest) }
  if (type === 'setStanding') {
    const { scope, ...preference } = rest
    if (scope !== null && (typeof scope !== 'string' || !/^[a-f0-9]{64}$/.test(scope))) throw new Error('Invalid runtime approval command')
    return { type, ...parseRuntimeApprovalPreference(preference), scope }
  }
  throw new Error('Invalid runtime approval command')
}

export function parseRuntimeApprovalView(value: unknown): RuntimeApprovalView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid runtime approval state')
  const item = value as Record<string, unknown>
  if (Object.keys(item).length !== 4 || typeof item.enabled !== 'boolean' || typeof item.standing !== 'boolean' || (item.owner !== null && typeof item.owner !== 'string') || (item.scope !== null && (typeof item.scope !== 'string' || !/^[a-f0-9]{64}$/.test(item.scope)))) throw new Error('Invalid runtime approval state')
  return { enabled: item.enabled, standing: item.standing, owner: item.owner, scope: item.scope }
}
