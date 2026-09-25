export interface RuntimeApprovalPreference { enabled: boolean }
export type RuntimeApprovalCommand = { type: 'get' } | { type: 'set', enabled: boolean }

export function parseRuntimeApprovalPreference(value: unknown): RuntimeApprovalPreference {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || typeof (value as RuntimeApprovalPreference).enabled !== 'boolean') throw new Error('Invalid runtime approval preference')
  return { enabled: (value as RuntimeApprovalPreference).enabled }
}

export function parseRuntimeApprovalCommand(value: unknown): RuntimeApprovalCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid runtime approval command')
  const { type, ...rest } = value as Record<string, unknown>
  if (type === 'get' && Object.keys(rest).length === 0) return { type }
  if (type === 'set') return { type, ...parseRuntimeApprovalPreference(rest) }
  throw new Error('Invalid runtime approval command')
}
