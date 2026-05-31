// useDateFormat — locale-aware absolute date/time formatting via Intl.
// Returns a stable formatter bound to the current i18n locale.

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

  function fmtTime(unixSec: number | null): string {
    if (!unixSec) return '—'
    return new Date(unixSec * 1000).toLocaleTimeString(locale.value, {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return { fmtDate, fmtTime }
}
