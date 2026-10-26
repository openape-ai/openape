import type { Briefing } from '../../shared/briefing'

type CalendarEvent = Briefing['calendar'][number]
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' })
export function eventDay(value: string): string {
  return value.length === 10 ? value : dayFormatter.format(new Date(value))
}
export function occursOn(event: CalendarEvent, day: string): boolean {
  const end = event.allDay ? event.end : eventDay(new Date(Math.max(Date.parse(event.start), Date.parse(event.end) - 1)).toISOString())
  return eventDay(event.start) <= day && (event.allDay ? day < end : day <= end)
}
export function calendarConflicts(events: CalendarEvent[]) {
  const timed = events.filter(event => !event.allDay)
  return timed.flatMap((first, index) => timed.slice(index + 1).flatMap((second) => {
    if (first.id === second.id && first.account === second.account) return []
    const start = Math.max(Date.parse(first.start), Date.parse(second.start))
    const end = Math.min(Date.parse(first.end), Date.parse(second.end))
    return start < end ? [{ first, second, start: new Date(start).toISOString(), minutes: (end - start) / 60000 }] : []
  }))
}
export function calendarTime(value: string): string {
  return new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}
export function calendarDate(value: string): string {
  return new Intl.DateTimeFormat('de-AT', { timeZone: value.length === 10 ? 'UTC' : 'Europe/Vienna', day: 'numeric', month: 'short' }).format(new Date(value))
}
