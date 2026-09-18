// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import IssueBrowser from '../app/components/IssueBrowser.vue'
import IssueCreate from '../app/components/IssueCreate.vue'
import IssueDetail from '../app/components/IssueDetail.vue'
import IssueEditor from '../app/components/IssueEditor.vue'
import IssueList from '../app/components/IssueList.vue'
import IssueMarkdown from '../app/components/IssueMarkdown.vue'

const button = defineComponent({ props: ['disabled', 'loading'], emits: ['click'], setup: (p, { slots, emit }) => () => h('button', { disabled: p.disabled || p.loading, onClick: () => emit('click') }, slots.default?.()) })
const input = defineComponent({ props: ['modelValue'], emits: ['update:modelValue'], setup: (p, { emit, attrs }) => () => h('input', { ...attrs, value: p.modelValue, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value) }) })
const textarea = defineComponent({ props: ['modelValue'], emits: ['update:modelValue'], setup: (p, { emit, attrs }) => () => h('textarea', { ...attrs, value: p.modelValue, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLTextAreaElement).value) }) })
const link = defineComponent({ props: ['to'], setup: (p, { slots }) => () => h('a', { href: p.to }, slots.default?.()) })
const alert = defineComponent({ props: ['title'], setup: p => () => h('p', { role: 'alert' }, p.title) })
const global = { stubs: { UButton: button, UInput: input, UTextarea: textarea, UAlert: alert, UBadge: { render() { return h('span', this.$slots.default?.()) } }, UIcon: true, NuxtLink: link, RepoHeader: true }, components: { IssueEditor, IssueList, IssueMarkdown } }
const record = { id: 'issue-a', number: 1, title: 'Keep context', body: 'Draft', bodyHtml: '<p>Draft</p>', state: 'open', version: 1, authorSubject: 'owner@test', authorActor: 'owner@test', assignee: null, productName: 'Plans', createdAt: 1, updatedAt: 1, labels: [], stableUrl: '/i/issue-a', repositoryUrl: '/owner/project/issues/1', capabilities: { repository: { owner: 'owner', name: 'project' }, edit: true, triage: true, admin: true, comment: true } }
const fetcher = vi.fn()
const navigate = vi.fn()
const route = reactive({ fullPath: '/issues', query: {} as Record<string, string> })
beforeEach(() => { vi.stubGlobal('$fetch', fetcher); vi.stubGlobal('navigateTo', navigate); vi.stubGlobal('useRoute', () => route); vi.stubGlobal('useRouter', () => ({ push: navigate })); fetcher.mockReset(); navigate.mockReset() })
afterEach(() => vi.unstubAllGlobals())

describe('issue interaction contracts', () => {
  it('shows loading, empty results and accessible record links', async () => {
    const wrapper = mount(IssueList, { props: { issues: [], total: 0, loading: true }, global })
    expect(wrapper.text()).toContain('Loading issues')
    await wrapper.setProps({ loading: false })
    expect(wrapper.text()).toContain('No issues match')
    await wrapper.setProps({ issues: [record] as never[], total: 1 })
    expect(wrapper.get('a').attributes('href')).toBe('/owner/project/issues/1')
    expect(wrapper.text()).toContain('Plans')
  })
  it('previews server-rendered Markdown and preserves a draft on preview errors', async () => {
    fetcher.mockResolvedValueOnce({ bodyHtml: '<p>Rendered preview</p>' })
    const wrapper = mount(IssueEditor, { props: { modelValue: '**draft**' }, global })
    await wrapper.findAll('button')[1]!.trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('Rendered preview')
    await wrapper.findAll('button')[0]!.trigger('click')
    fetcher.mockRejectedValueOnce({ statusCode: 401 })
    await wrapper.findAll('button')[1]!.trigger('click'); await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('**draft**')
    expect(wrapper.text()).toContain('session expired')
  })
  it('keeps the same creation idempotency key after a network failure', async () => {
    fetcher.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(record)
    const wrapper = mount(IssueCreate, { props: { owner: 'owner', name: 'project' }, global })
    await flushPromises()
    await wrapper.get('input[aria-label="Title"]').setValue('Keep context')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.text()).toContain('draft is kept')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(fetcher.mock.calls[0]![1].headers['Idempotency-Key']).toBe(fetcher.mock.calls[1]![1].headers['Idempotency-Key'])
    expect(navigate).toHaveBeenCalledWith('/owner/project/issues/1')
  })
  it('keeps an edit draft on a stale-version response and shows the explicit reload action', async () => {
    fetcher.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (options?.method === 'PATCH') throw Object.assign(new Error('Conflict'), { statusCode: 409 })
      if (path.endsWith('/comments')) return { comments: [], next: null }
      if (path.endsWith('/labels')) return { labels: [] }
      if (path.endsWith('/issue-assignees')) return { assignees: [] }
      return record
    })
    const wrapper = mount(IssueDetail, { props: { endpoint: '/api/issue-records/issue-a' }, global })
    await flushPromises()
    await wrapper.findAll('button').find(b => b.text() === 'Edit issue')!.trigger('click')
    await wrapper.get('input[aria-label="Title"]').setValue('Unsaved title')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('input[aria-label="Title"]').element.value).toBe('Unsaved title')
    expect(wrapper.text()).toContain('Reload current version')
  })
  it('does not offer repository triage to a report participant', async () => {
    fetcher.mockImplementation(async (path: string) => path.endsWith('/comments') ? { comments: [], next: null } : { ...record, number: null, repositoryUrl: null, capabilities: { repository: null, edit: false, triage: false, admin: false, comment: true } })
    const wrapper = mount(IssueDetail, { props: { endpoint: '/api/issue-records/issue-a' }, global })
    await flushPromises()
    expect(wrapper.text()).not.toContain('Save metadata')
    expect(wrapper.text()).not.toContain('owner/project')
    expect(wrapper.text()).toContain('Leave a comment')
  })
  it('removes stale records and facets after access changes', async () => {
    fetcher.mockImplementation(async path => path === '/api/issue-facets' ? { repositories: [{ owner: 'owner', name: 'project' }], labels: [], products: [], assignees: [], canCreate: true } : { issues: [record], total: 1, cursor: null })
    const wrapper = mount(IssueBrowser, { global })
    await flushPromises()
    expect(wrapper.text()).toContain('Keep context')
    fetcher.mockRejectedValue({ statusCode: 403 })
    route.fullPath = '/issues?q=changed'
    await flushPromises()
    expect(wrapper.text()).not.toContain('Keep context')
    expect(wrapper.text()).not.toContain('owner/project')
    expect(wrapper.text()).toContain('access has changed')
  })
})
