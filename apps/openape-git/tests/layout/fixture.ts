import type { IssueRecord } from '../../shared/issue-types'
import type { Component } from 'vue'
import { mount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import { expect, vi } from 'vitest'
import { reactive } from 'vue'

export const owner = 'owner@issues.test'
export const title = 'Report a problem without losing context'
export const markdown = `<h2>Expected behavior</h2><p>Keep <strong>product context</strong> after login.</p><pre><code>${'a'.repeat(160)}</code></pre>`
export const record: IssueRecord = {
  id: 'issue-a', number: 1, title, body: '## Expected behavior', bodyHtml: markdown,
  state: 'open', version: 1, hidden: 0, triageState: 'classified', authorSubject: owner, authorActor: owner,
  assignee: null, productName: 'Plans', createdAt: 1, updatedAt: 1,
  labels: [] as { id: string, name: string, color: string }[],
  stableUrl: '/i/issue-a', repositoryUrl: '/owner/project/issues/1',
  capabilities: { repository: { owner: 'owner', name: 'project' }, edit: true, triage: true, admin: true, comment: true },
}
export interface RequestOptions { method?: string, body?: Record<string, unknown>, query?: Record<string, unknown>, headers?: Record<string, string> }
export function transport(handler?: (path: string, options: RequestOptions) => unknown) {
  const fetcher = vi.fn(async (path: string, options: RequestOptions = {}) => {
    const result = handler?.(path, options)
    if (result !== undefined) return result
    if (options.method && options.method !== 'GET') throw new Error(`Unexpected mutation: ${path}`)
    if (path.endsWith('/metadata')) return { issueHomeOnly: 0, codeSourceUrl: null }
    if (path.endsWith('/comments')) return { comments: [], next: null }
    if (path.endsWith('/labels')) return { labels: [{ id: 'bug', name: 'bug', color: '#f59e0b', archived: 0 }] }
    if (path.endsWith('/issue-assignees')) return { assignees: [owner] }
    if (path.endsWith('/pulls')) return { pulls: [] }
    if (path === '/api/issue-records/issue-a') return structuredClone(record)
    throw new Error(`Unexpected request: ${path}`)
  })
  vi.stubGlobal('$fetch', fetcher)
  return fetcher
}
export function navigation(query: Record<string, string> = {}) {
  const route = reactive({ query, fullPath: '/issues', params: { owner: 'owner', name: 'project', number: '7' } })
  const navigate = vi.fn()
  const push = vi.fn(async ({ query }: { query: Record<string, string> }) => {
    route.query = query
    route.fullPath = `/issues?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined)).toString()}`
  })
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ push, replace: push }))
  vi.stubGlobal('navigateTo', navigate)
  return { route, navigate, push }
}
export function render(component: Component, props = {}) {
  return mount(component, { props, attachTo: document.body })
}
export async function layouts(name: string, inspect?: (width: number) => void) {
  for (const [size, width, height] of [['mobile', 390, 844], ['desktop', 1440, 1000]] as const) {
    await page.viewport(width, height)
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    expect(document.documentElement.scrollWidth, `${name} ${size} overflow`).toBeLessThanOrEqual(innerWidth)
    inspect?.(width)
    await page.viewport(width, Math.max(height, document.body.scrollHeight))
    await page.screenshot({ path: `../../.artifacts/ui-test-migration/${name}-${size}.png`, fullPage: true })
  }
}
