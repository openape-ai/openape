export type ScheduleSpec = { kind: 'interval', seconds: number } | { kind: 'daily', time: string, timezone: string }
export interface ScheduleView { spec: ScheduleSpec | null, enabled: boolean, revision: number, nextAt: number | null, error: string | null, pending: number, blocked: number, concurrency: number }
export type ScheduleCommand = { type: 'list', podId: string } | { type: 'save', podId: string, revision: number, spec: ScheduleSpec, enabled: boolean } | { type: 'concurrency', podId: string, maximum: number } | { type: 'lifecycle', podId: string, revision: number, lifecycle: 'active' | 'paused' }
export function parseSchedule(value: unknown): ScheduleSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid schedule')
  const spec = value as Record<string, unknown>
  if (spec.kind === 'interval' && Object.keys(spec).every(key => ['kind', 'seconds'].includes(key)) && Number.isSafeInteger(spec.seconds) && (spec.seconds as number) >= 60 && (spec.seconds as number) <= 2592000) return { kind: 'interval', seconds: spec.seconds as number }
  if (spec.kind === 'daily' && Object.keys(spec).every(key => ['kind', 'time', 'timezone'].includes(key)) && typeof spec.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(spec.time) && typeof spec.timezone === 'string' && spec.timezone.length <= 100) {
    new Intl.DateTimeFormat('en', { timeZone: spec.timezone }).format(0)
    return { kind: 'daily', time: spec.time, timezone: spec.timezone }
  }
  throw new Error('Unsupported schedule')
}
export function parseScheduleCommand(value: unknown): ScheduleCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid schedule command')
  const item = value as Record<string, unknown>
  const keys = item.type === 'list' ? ['type', 'podId'] : item.type === 'save' ? ['type', 'podId', 'revision', 'spec', 'enabled'] : item.type === 'lifecycle' ? ['type', 'podId', 'revision', 'lifecycle'] : item.type === 'concurrency' ? ['type', 'podId', 'maximum'] : []
  if (!keys.length || Object.keys(item).some(key => !keys.includes(key)) || typeof item.podId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.podId)) throw new Error('Unsupported schedule command')
  if (item.type === 'save') {
    if (!Number.isSafeInteger(item.revision) || (item.revision as number) < 0 || typeof item.enabled !== 'boolean') throw new Error('Invalid schedule revision or activation')
    return { type: 'save', podId: item.podId, revision: item.revision as number, enabled: item.enabled, spec: parseSchedule(item.spec) }
  }
  if (item.type === 'lifecycle' && (!Number.isSafeInteger(item.revision) || (item.revision as number) < 1 || !['active', 'paused'].includes(item.lifecycle as string))) throw new Error('Invalid lifecycle update')
  if (item.type === 'concurrency' && (!Number.isSafeInteger(item.maximum) || (item.maximum as number) < 1 || (item.maximum as number) > 16)) throw new Error('Concurrency must be between 1 and 16')
  return item as unknown as ScheduleCommand
}
export function parseScheduleView(value: unknown): ScheduleView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid schedule view')
  const view = value as ScheduleView
  if (view.spec !== null) parseSchedule(view.spec)
  if (typeof view.enabled !== 'boolean' || !Number.isSafeInteger(view.revision) || view.revision < 0 || (view.nextAt !== null && !Number.isSafeInteger(view.nextAt)) || (view.error !== null && typeof view.error !== 'string') || !Number.isSafeInteger(view.pending) || view.pending < 0 || !Number.isSafeInteger(view.blocked) || view.blocked < 0 || !Number.isSafeInteger(view.concurrency) || view.concurrency < 1 || view.concurrency > 16) throw new Error('Invalid schedule state')
  return view
}
