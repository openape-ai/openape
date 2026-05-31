// Locale-aware absolute date/time formatting via Intl. Same pattern
// as troop; locale-reactive via @nuxtjs/i18n.

export function useDateFormat() {
  const { locale } = useI18n()

  function fmtDate(unixSec: number | null): string {
    if (!unixSec) return '—'
    return new Date(unixSec * 1000).toLocaleString(locale.value, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function fmtDay(isoDay: string | null): string {
    if (!isoDay) return '—'
    // isoDay = 'YYYY-MM-DD'. Build a midnight-local Date to avoid TZ drift.
    const [y, m, d] = isoDay.split('-').map(Number)
    if (!y || !m || !d) return isoDay
    return new Date(y, m - 1, d).toLocaleDateString(locale.value, { day: '2-digit', month: '2-digit' })
  }

  return { fmtDate, fmtDay }
}
