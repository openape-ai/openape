import type { RunEvent } from '../contracts/runs'

export interface ActivityItem { sequence: number, at: number, title: string, state: string }
const operations: Record<string, string> = { 'tools.invoke': 'Application call', 'agent.run': 'AI request', 'http.request': 'HTTP delivery', 'progress.commit': 'Save progress', 'credentials.get': 'Read an assigned secret', 'mail.next': 'Read mail', 'mail.commit': 'Save mail knowledge' }
export function runActivity(events: RunEvent[]): ActivityItem[] {
  const items: ActivityItem[] = []
  const active = new Map<string, ActivityItem>()
  for (const event of events) {
    const data = (event.data ?? {}) as Record<string, unknown>
    if (event.type === 'operation' && typeof data.id === 'string' && typeof data.operation === 'string') {
      const item = active.get(data.id)
      if (item) { item.state = String(data.state); continue }
      const next = { sequence: event.sequence, at: event.at, title: operations[data.operation] ?? 'Script operation', state: String(data.state) }
      items.push(next); active.set(data.id, next); continue
    }
    if (event.type === 'approval') {
      const key = `grant:${String(data.grantId)}`; const item = active.get(key)
      if (item) { item.state = data.state === 'approved' ? 'completed' : String(data.state); continue }
      const next = { sequence: event.sequence, at: event.at, title: 'Permission review', state: data.state === 'approved' ? 'completed' : String(data.state) }
      items.push(next); active.set(key, next); continue
    }
    const titles: Record<string, string> = { started: 'Run prepared', process: 'Script started', checkpoint: 'Progress saved', finished: 'Run finished', interrupted: 'Run interrupted' }
    if (titles[event.type]) items.push({ sequence: event.sequence, at: event.at, title: titles[event.type], state: event.type === 'finished' ? String(data.state) : event.type === 'interrupted' ? 'interrupted' : 'completed' })
  }
  return items
}
export function runFailure(error: string | null): { title: string, help: string } | null {
  if (!error) return null
  if (/Identity authorization failed|permission service rejected/i.test(error)) return { title: 'The permission service rejected this operation', help: 'Review the Pod permissions and grant status. This error alone does not mean that the application needs a new sign-in.' }
  if (/Permission (?:denied|revoked)|grant is no longer approved|no longer active/i.test(error)) return { title: 'Permission was not granted', help: 'Review the Pod permissions before starting another run.' }
  if (/approval expired/.test(error)) return { title: 'The approval wait expired', help: 'Start another run when you are ready to review the approval.' }
  if (/OpenApe rejected this Pod identity/.test(error)) return { title: 'The Pod identity needs attention', help: 'Check the OpenApe owner assigned to this Pod in App settings. Application accounts are separate.' }
  if (/fetch failed|network|ECONN|ENOTFOUND/i.test(error)) return { title: 'The service could not be reached', help: 'Check the network connection. Inspect any uncertain delivery before retrying.' }
  if (/OpenApe authentication expired/.test(error)) return { title: 'OpenApe sign-in needs attention', help: 'Reconnect the Pod owner in App settings.' }
  if (/HTTP delivery|external effect|External effect|outcome.*unknown/.test(error)) return { title: 'Delivery needs review', help: 'Check the destination before retrying to avoid sending the same notification twice.' }
  return { title: 'This run could not finish', help: 'Review the last operation and technical details. Check stopped execution before retrying.' }
}

export function runTiming(events: RunEvent[], startedAt: number, endedAt: number) {
  let waiting = 0; let began: number | undefined
  const pending = new Set<string>()
  for (const event of events) {
    if (event.type !== 'approval') continue
    const data = event.data as { grantId?: string, state?: string }
    if (!data.grantId) continue
    if (data.state === 'pending') {
      if (!pending.size) began = event.at
      pending.add(data.grantId)
    }
    else {
      pending.delete(data.grantId)
      if (!pending.size && began !== undefined) { waiting += event.at - began; began = undefined }
    }
  }
  if (began !== undefined) waiting += Math.max(0, endedAt - began)
  const total = Math.max(0, endedAt - startedAt)
  return { active: duration(Math.max(0, total - waiting)), waiting: duration(Math.min(total, waiting)) }
}
export function duration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
