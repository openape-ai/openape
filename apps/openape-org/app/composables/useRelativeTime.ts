// Locale-aware relative-time formatter via Intl.RelativeTimeFormat.
// Same pattern as troop.

export function useRelativeTime() {
  const { locale, t } = useI18n()

  function fmtRelative(unixSec: number | null): string {
    if (!unixSec) return t('time.never')
    const deltaSec = Math.floor(Date.now() / 1000) - unixSec
    if (deltaSec < 5) return t('time.justNow')
    const rtf = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' })
    if (deltaSec < 60) return rtf.format(-deltaSec, 'second')
    if (deltaSec < 3600) return rtf.format(-Math.floor(deltaSec / 60), 'minute')
    if (deltaSec < 86400) return rtf.format(-Math.floor(deltaSec / 3600), 'hour')
    if (deltaSec < 86400 * 30) return rtf.format(-Math.floor(deltaSec / 86400), 'day')
    if (deltaSec < 86400 * 365) return rtf.format(-Math.floor(deltaSec / (86400 * 30)), 'month')
    return rtf.format(-Math.floor(deltaSec / (86400 * 365)), 'year')
  }

  return { fmtRelative }
}
