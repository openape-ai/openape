import type { MenuItemConstructorOptions } from 'electron'
import type { ItemTags, StoredPod } from '../contracts/control'
import type { Language } from '../contracts/language'
import type { RunRecord, RunState } from '../contracts/runs'
import { translate } from '../i18n'

const indicators: Record<RunState, string> = {
  completed: '🟢',
  failed: '🔴',
  running: '🟡',
  completedWithGaps: '🟠',
  blocked: '🟠',
  cancelled: '🟠',
  interrupted: '🟠',
}

export function trayTags(pods: StoredPod[], tags: ItemTags[], language: Language): string[] {
  const ids = new Set(pods.map(pod => pod.id))
  return [...new Set(tags.filter(item => ids.has(item.id)).flatMap(item => item.tags))]
    .sort(new Intl.Collator(language, { sensitivity: 'base', numeric: true }).compare)
}

export function trayTagItems(tags: string[], selected: string | null, language: Language, select: (tag: string | null) => void): MenuItemConstructorOptions[] {
  return [
    {
      label: selected ? `${translate(language, 'Tags')}: ${selected}` : translate(language, 'Tags'),
      submenu: [
        { label: translate(language, 'All Pods'), type: 'radio', checked: selected === null, click: () => select(null) },
        ...tags.map(tag => ({ label: tag, type: 'radio' as const, checked: selected === tag, click: () => select(tag) })),
      ],
    },
    { type: 'separator' },
  ]
}

export function trayPodItems(entries: { pod: StoredPod, runs: RunRecord[] }[], language: Language, open: () => void): MenuItemConstructorOptions[] {
  const collator = new Intl.Collator(language, { sensitivity: 'base', numeric: true })
  const time = new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' })
  if (!entries.length) return [{ label: translate(language, 'No pods yet'), click: open }]
  return [...entries].sort((a, b) => collator.compare(a.pod.name, b.pod.name) || a.pod.id.localeCompare(b.pod.id)).map(({ pod, runs }) => {
    const latest = runs.reduce<RunRecord | undefined>((last, run) => !last || run.startedAt > last.startedAt ? run : last, undefined)
    const indicator = latest ? indicators[latest.state] : '⚪'
    const lastRun = latest ? `${translate(language, 'Last run')}: ${time.format(latest.startedAt)}` : translate(language, 'Never run')
    return { id: pod.id, label: `${indicator} ${pod.name} — ${lastRun}`, click: open }
  })
}
