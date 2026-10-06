import type { RequestHeaders } from '@openape/core'
// The negotiation lives in @openape/core so the SP module uses the same one —
// a second copy here is how the two drifted apart in the first place (#1043).
import { wantsHtmlErrorPage } from '@openape/core'

export type { RequestHeaders }
export { wantsHtmlErrorPage }

interface ErrorCopy {
  title: string
  message: string
}

const STATUS_COPY: Record<number, ErrorCopy> = {
  400: {
    title: 'Ungültige Anfrage',
    message: 'Diese Anfrage konnte nicht verarbeitet werden. Bitte geh einen Schritt zurück und versuch es noch einmal.',
  },
  401: {
    title: 'Anmeldung erforderlich',
    message: 'Für diese Seite musst du angemeldet sein. Bitte melde dich an und versuch es dann erneut.',
  },
  403: {
    title: 'Kein Zugriff',
    message: 'Du hast keine Berechtigung, diese Seite zu öffnen. Wenn du glaubst, dass das ein Irrtum ist, wende dich an die Person, die dir den Zugang eingerichtet hat.',
  },
  404: {
    title: 'Seite nicht gefunden',
    message: 'Diese Seite gibt es nicht oder sie wurde verschoben. Bitte prüfe die Adresse oder starte noch einmal von der Startseite.',
  },
  429: {
    title: 'Zu viele Anfragen',
    message: 'Von deinem Anschluss kamen gerade sehr viele Anfragen. Das ist eine Schutzmaßnahme und kein Fehler von dir — bitte warte einen Moment.',
  },
}

const CLIENT_ERROR_FALLBACK: ErrorCopy = {
  title: 'Anfrage nicht möglich',
  message: 'Diese Anfrage konnte nicht ausgeführt werden. Bitte geh einen Schritt zurück und versuch es noch einmal.',
}

const SERVER_ERROR_FALLBACK: ErrorCopy = {
  title: 'Serverfehler',
  message: 'Auf dem Server ist ein unerwarteter Fehler aufgetreten. Bitte versuch es in ein paar Minuten noch einmal.',
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

// Countdown for 429 pages: ticks the visible wait time down and reloads
// once it reaches zero. The page stays fully usable without JS — the
// static wait time and the reload link are already in the markup.
const COUNTDOWN_SCRIPT = `<script>
(function () {
  var el = document.querySelector('[data-countdown]')
  if (!el) return
  var seconds = parseInt(el.getAttribute('data-countdown'), 10)
  if (!(seconds > 0)) return
  var timer = setInterval(function () {
    seconds -= 1
    if (seconds <= 0) {
      clearInterval(timer)
      location.reload()
      return
    }
    el.textContent = 'etwa ' + seconds + ' ' + (seconds === 1 ? 'Sekunde' : 'Sekunden')
  }, 1000)
})()
</script>`

/**
 * Self-contained German error page: inline CSS only, light/dark via
 * prefers-color-scheme, no external assets. Deliberately renders ONLY
 * copy defined in this file plus a sanitized integer — never request
 * data (URL, query, headers) and never internal error details.
 */
export function renderErrorPage(rawStatus: number, opts: { retryAfterSeconds?: number } = {}): string {
  // Normalize before interpolating: only a plain HTTP status ever
  // reaches the markup, no matter what shape the thrown error had.
  const status = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : 500
  const copy = STATUS_COPY[status] ?? (status >= 500 ? SERVER_ERROR_FALLBACK : CLIENT_ERROR_FALLBACK)
  const retry = opts.retryAfterSeconds
  const seconds = typeof retry === 'number' && Number.isFinite(retry) && retry > 0
    ? Math.ceil(retry)
    : undefined

  const title = escapeHtml(copy.title)
  const message = escapeHtml(copy.message)
  const waitLine = seconds !== undefined
    ? `<p>Du kannst es in <strong data-countdown="${seconds}">etwa ${seconds} ${seconds === 1 ? 'Sekunde' : 'Sekunden'}</strong> wieder versuchen.</p>`
    : ''

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${status} – ${title}</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: #fafafa;
  color: #1c1c1e;
}
main { max-width: 26rem; padding: 2rem; text-align: center; }
.status { font-size: 5rem; font-weight: 800; line-height: 1; margin: 0; color: #d4d4d8; }
h1 { font-size: 1.4rem; margin: 0.75rem 0 0; }
p { margin: 1rem 0 0; line-height: 1.55; color: #52525b; }
.retry {
  display: inline-block;
  margin-top: 1.75rem;
  padding: 0.6rem 1.4rem;
  border-radius: 0.5rem;
  background: #1c1c1e;
  color: #fafafa;
  text-decoration: none;
  font-weight: 600;
}
@media (prefers-color-scheme: dark) {
  body { background: #18181b; color: #fafafa; }
  .status { color: #3f3f46; }
  p { color: #a1a1aa; }
  .retry { background: #fafafa; color: #18181b; }
}
</style>
</head>
<body>
<main>
<p class="status">${status}</p>
<h1>${title}</h1>
<p>${message}</p>
${waitLine}
<a class="retry" href="">Erneut versuchen</a>
</main>
${seconds !== undefined ? COUNTDOWN_SCRIPT : ''}
</body>
</html>
`
}
