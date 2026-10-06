import type { IconName } from '../components/AppIcon.vue'

export type Audience = 'private' | 'readers' | 'team' | 'public' | 'link'
export type Kind = 'report' | 'plan' | 'testrun'
export type AuthorType = 'person' | 'agent' | null

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY = 86400000
const time = (t: Date) => `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

export function shortDate(at: number, now = Date.now()) {
  const t = new Date(at)
  if (sameDay(t, new Date(now))) return `Today ${time(t)}`
  if (sameDay(t, new Date(now - DAY))) return 'Yesterday'
  return `${MONTHS[t.getMonth()]!.slice(0, 3)} ${t.getDate()}${t.getFullYear() === new Date(now).getFullYear() ? '' : `, ${t.getFullYear()}`}`
}
export function longDate(at: number) {
  const t = new Date(at)
  return `${MONTHS[t.getMonth()]} ${t.getDate()}, ${t.getFullYear()} at ${time(t)}`
}
export function groupLabel(at: number, now = Date.now()) {
  const t = new Date(at); const today = new Date(now)
  if (now - at < 7 * DAY) return 'Last 7 days'
  if (t.getMonth() === today.getMonth() && t.getFullYear() === today.getFullYear()) return 'Earlier this month'
  return `${MONTHS[t.getMonth()]}${t.getFullYear() === today.getFullYear() ? '' : ` ${t.getFullYear()}`}`
}
export const daysLeft = (at: number, now = Date.now()) => Math.max(0, Math.ceil((at - now) / DAY))
export const days = (count: number) => count === 1 ? '1 day' : `${count} days`

export function kindOf(category: string | null): Kind {
  if (category === 'Plans') return 'plan'
  if (category === 'Test Runs') return 'testrun'
  return 'report'
}
export const KIND_LABEL: Record<Kind, string> = { report: 'Report', plan: 'Plan', testrun: 'Test Run' }
export const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

export interface AccessInfo { icon: IconName, short: string, long: string, hint: string }
export function accessInfo(audience: Audience, team?: string | null, readers?: string[] | null): AccessInfo {
  switch (audience) {
    case 'private': return { icon: 'lock', short: 'Only you', long: 'Only you can open this report.', hint: 'New reports start private.' }
    case 'team': return { icon: 'team', short: team || 'A team', long: `Members of ${team || 'the team'} can open it.`, hint: 'Team access follows team membership.' }
    case 'readers': return { icon: 'people', short: readers ? `${readers.length + 1} people` : 'Named people', long: readers ? `The owner and ${readers.join(', ')} can open it.` : 'The owner and named people can open it.', hint: 'Each named reader signs in to read.' }
    case 'link': return { icon: 'link', short: 'Anyone with the link', long: 'Anyone with the link can open it, without signing in.', hint: 'Earlier Test Run uploads were shared by link.' }
    case 'public': return { icon: 'network', short: 'Public', long: 'Anyone can open it, without signing in.', hint: 'Public reports can be found and forwarded.' }
  }
}
export const AUTHOR_LABEL = { person: 'Person', agent: 'AI agent' } as const
