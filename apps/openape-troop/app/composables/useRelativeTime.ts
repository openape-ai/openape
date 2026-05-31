// useRelativeTime — locale-aware "X seconds ago" / "vor X Sekunden" output.
//
// Returns a function bound to the current locale via @nuxtjs/i18n. Switching
// language with the LocaleSwitcher swaps the formatter immediately — no
// page reload needed.
//
// `Intl.RelativeTimeFormat` handles plurals + auto-pick of "just now" /
// "yesterday" via { numeric: 'auto' } so "0s" → "now"/"jetzt".

export function useRelativeTime() {
  const { locale, t } = useI18n()

  function fmtRelative(unixSec: number | null): string {
    if (!unixSec) return t('time.never')
    const deltaSec = Math.floor(Date.now() / 1000) - unixSec
    if (deltaSec < 0) return t('time.justNow')
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
