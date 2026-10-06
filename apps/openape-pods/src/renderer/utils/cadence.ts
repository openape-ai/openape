import type { MapSchedule } from '../../contracts/map-view'
import { t } from '../i18n'

/** The schedule of a Pod or collection as the owner reads it. */
export function cadence(schedule: MapSchedule | null, takes: string[] = []): string {
  const spec = schedule?.spec
  if (!spec) return takes.length ? t('on items') : '–'
  if (spec.kind === 'interval') return spec.seconds % 3600 === 0 ? t('every {count} h', { count: spec.seconds / 3600 }) : spec.seconds % 60 === 0 ? t('every {count} min', { count: spec.seconds / 60 }) : t('every {count} s', { count: spec.seconds })
  if (spec.kind === 'daily') return t('daily {time}', { time: spec.time })
  if (spec.kind === 'cron') return spec.expression
  return new Date(spec.at).toLocaleString()
}

export function ago(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60000)
  if (minutes < 1) return t('just now')
  if (minutes < 60) return t('{count} min ago', { count: minutes })
  if (minutes < 1440) return t('{count} h ago', { count: Math.round(minutes / 60) })
  return t('{count} d ago', { count: Math.round(minutes / 1440) })
}

export const clock = (at: number, language: string) => new Intl.DateTimeFormat(language === 'de' ? 'de-AT' : 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(at))
export const stamp = (at: number, language: string) => new Intl.DateTimeFormat(language === 'de' ? 'de-AT' : 'en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(at))
