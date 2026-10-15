import { defineComponent, h } from 'vue'
import { vi } from 'vitest'
import { createInbox } from '../../app/inbox/client'
import type { InboxItem, Receipt } from '../../app/inbox/client'

export function decision(change: Partial<InboxItem> = {}): InboxItem {
  return {
    id: crypto.randomUUID(),
    kind: 'decision',
    state: 'open',
    title: 'Rechnung an Buchhaltung zustellen?',
    body: 'Die Buchhaltung wartet auf die Rechnung.',
    pod: { id: crypto.randomUUID(), name: 'Belege', tags: ['finanzen'] },
    runId: null,
    links: [],
    created: 1792051200000,
    sequence: 1,
    read: null,
    archived: null,
    deleted: null,
    decision: { sourceId: 'question:mail-1', digest: 'a'.repeat(64), type: 'question', authority: 'pods', runtimeId: crypto.randomUUID(), options: [{ key: 'deliver', title: 'Erneut zustellen', input: null }, { key: 'seen', title: 'Bereits zugestellt', input: 'evidence' }] },
    ...change,
  }
}

// Only HTTP, time and Nuxt navigation are substituted. The production client,
// pages, shell, controls and their SFC styles run unchanged in Chromium.
export function transport(items: InboxItem[]) {
  const server = { items, operation: 'accepted' as Receipt['state'], fail: false }
  const requests: { path: string, body: Record<string, unknown> }[] = []
  const timers: { run: () => Promise<void>, cancelled: boolean }[] = []
  const json = (body: unknown, status = 200) => Response.json(body, { status })
  const inbox = createInbox({
    storage: null,
    now: () => 1792051200000,
    navigate: () => { throw new Error('Unexpected real navigation') },
    wait: async () => {},
    later: (_ms, run) => { const timer = { run, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true } },
    fetch: async (path, init) => {
      if (server.fail) return json({ code: 'fixture_unavailable' }, 503)
      if (path.endsWith('/session')) return json({ subject: 'owner@inbox.example', issuer: 'https://id.example', device: 'fixture-device', vapidPublicKey: '' })
      if (path.includes('/changes?')) return json({ items: server.items, cursor: 1, more: false, device: 'fixture-device' })
      if (path.endsWith('/decide')) {
        requests.push({ path, body: JSON.parse(String(init.body)) })
        return json({ operation: { state: 'accepted', error: null } })
      }
      if (path.includes('/operations/')) return json({ operation: { state: server.operation, error: null } })
      if (path.endsWith('/devices')) return json({ devices: [] })
      throw new Error(`Unexpected fixture request: ${init.method} ${path}`)
    },
  })
  return { inbox, server, requests, elapse: async () => { for (const timer of timers.splice(0)) { if (!timer.cancelled) await timer.run() } } }
}

export const route = { path: '/inbox/', params: {} as Record<string, string>, query: {} as Record<string, string> }
export function installNuxtBoundary() {
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
  vi.stubGlobal('useHead', vi.fn())
  vi.stubGlobal('useRuntimeConfig', () => ({ app: { buildId: 'synthetic-layout-build' } }))
  // The worker lifecycle belongs to real E2E; no worker is installed in this fixture origin.
  vi.spyOn(navigator.serviceWorker, 'register').mockRejectedValue(new Error('Worker registration belongs to E2E'))
}
export const NuxtLink = defineComponent({
  props: ['to'],
  setup(props, { slots }) {
    return () => h('a', { href: typeof props.to === 'string' ? props.to : `${props.to.path}?${new URLSearchParams(props.to.query)}`, onClick: (event: Event) => event.preventDefault() }, slots.default?.())
  },
})
