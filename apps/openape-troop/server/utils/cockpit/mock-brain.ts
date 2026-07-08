// Fallback "brain" used when no external agent is connected, so the deployed demo
// always answers. The real service-agent produces the same event shape via the queue.
const REPLIES = [
  `Klar, hier ist ein kompaktes Beispiel in **TypeScript**:

\`\`\`ts
function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}
\`\`\`

Der Timer wird bei jedem Aufruf zurückgesetzt, sodass \`fn\` erst nach der Ruhephase feuert.`,

  `Gute Frage. Drei Dinge helfen fast immer:

1. **Messen statt raten** – erst ein Profil ziehen, dann optimieren.
2. **Arbeit vermeiden** – der schnellste Code ist der, der nie läuft.
3. **Caching an der Grenze** – Ergebnisse dort halten, wo sie teuer sind.

> Premature optimization is the root of all evil. — *Knuth*`,

  `Zusammengefasst:

- Der Ansatz ist solide.
- Achte auf die Fehlerbehandlung an den Rändern.
- Kleine, getestete Schritte schlagen den großen Wurf.

Willst du, dass ich das in Code gieße?`,

  `Das lässt sich elegant lösen. Wir streamen die Antwort Token für Token, damit sich die UI lebendig anfühlt – kein Warten auf die Gesamtantwort.`,
]

interface Msg { role: string; content: string }

function lastUser(messages: Msg[]): string {
  return [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
}

export function pickReply(messages: Msg[]): string {
  const last = lastUser(messages)
  if (/code|beispiel|typescript|function|stream/i.test(last)) return REPLIES[0]!
  if (/schnell|performance|optimier/i.test(last)) return REPLIES[1]!
  return REPLIES[messages.length % REPLIES.length]!
}

export function thinkingFor(messages: Msg[]): string[] {
  const last = lastUser(messages)
  const steps = ['Analysiere die Frage …', 'Ziehe relevanten Kontext heran …', 'Formuliere die Antwort …']
  if (/code|beispiel|typescript|function|stream/i.test(last)) steps[1] = 'Suche ein passendes Codebeispiel …'
  if (/schnell|performance|optimier/i.test(last)) steps[1] = 'Prüfe die relevanten Kennzahlen …'
  return steps
}

/** Split into word-sized tokens, keeping trailing whitespace/newlines intact. */
export function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text]
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function streamMock(
  messages: Msg[],
  emit: (obj: unknown) => void,
  isAborted: () => boolean,
): Promise<void> {
  for (const line of thinkingFor(messages)) {
    if (isAborted()) return
    emit({ k: 'think', text: line })
    await delay(360 + Math.random() * 380)
  }
  for (const tok of tokenize(pickReply(messages))) {
    if (isAborted()) return
    emit({ k: 'tok', t: tok })
    await delay(40 + Math.random() * 90)
  }
}
