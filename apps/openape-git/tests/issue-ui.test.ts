// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import IssueBrowser from '../app/components/IssueBrowser.vue'
import IssueCreate from '../app/components/IssueCreate.vue'
import IssueDetail from '../app/components/IssueDetail.vue'
import IssueEditor from '../app/components/IssueEditor.vue'
import IssueList from '../app/components/IssueList.vue'
import IssueMarkdown from '../app/components/IssueMarkdown.vue'
import IssueReport from '../app/components/IssueReport.vue'
import IssuePolicy from '../app/components/IssuePolicy.vue'
import IssueTriage from '../app/components/IssueTriage.vue'
import IssuePullLinks from '../app/components/IssuePullLinks.vue'
import PullIssueLinks from '../app/components/PullIssueLinks.vue'
import RepoHeader from '../app/components/RepoHeader.vue'

enableAutoUnmount(afterEach)

const button = defineComponent({ props: ['disabled', 'loading'], emits: ['click'], setup: (p, { slots, emit }) => () => h('button', { disabled: p.disabled || p.loading, onClick: () => emit('click') }, slots.default?.()) })
const input = defineComponent({ props: ['modelValue'], emits: ['update:modelValue'], setup: (p, { emit, attrs }) => () => h('input', { ...attrs, value: p.modelValue, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value) }) })
const textarea = defineComponent({ props: ['modelValue'], emits: ['update:modelValue'], setup: (p, { emit, attrs }) => () => h('textarea', { ...attrs, value: p.modelValue, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLTextAreaElement).value) }) })
const link = defineComponent({ props: ['to'], setup: (p, { slots }) => () => h('a', { href: p.to }, slots.default?.()) })
const alert = defineComponent({ props: ['title'], setup: p => () => h('p', { role: 'alert' }, p.title) })
const global = { stubs: { UButton: button, UInput: input, UTextarea: textarea, UAlert: alert, UBadge: { render() { return h('span', this.$slots.default?.()) } }, UIcon: true, NuxtLink: link, RepoHeader: true, IssueTriage: true, IssuePullLinks: true }, components: { IssueEditor, IssueList, IssueMarkdown } }
const record = { id: 'issue-a', number: 1, title: 'Keep context', body: 'Draft', bodyHtml: '<p>Draft</p>', state: 'open', version: 1, authorSubject: 'owner@test', authorActor: 'owner@test', assignee: null, productName: 'Plans', createdAt: 1, updatedAt: 1, labels: [], stableUrl: '/i/issue-a', repositoryUrl: '/owner/project/issues/1', capabilities: { repository: { owner: 'owner', name: 'project' }, edit: true, triage: true, admin: true, comment: true } }
const fetcher = vi.fn()
const navigate = vi.fn()
const route = reactive({ fullPath: '/issues', query: {} as Record<string, string> })
beforeEach(() => { vi.stubGlobal('$fetch', fetcher); vi.stubGlobal('navigateTo', navigate); vi.stubGlobal('useRoute', () => route); vi.stubGlobal('useRouter', () => ({ push: navigate })); fetcher.mockReset(); navigate.mockReset(); route.query = {} })
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
  it('requires a fresh audience review after a routing conflict without losing the report draft', async () => {
    const catalog = { products: [{ key: 'plans', name: 'Plans' }], selected: { key: 'plans', name: 'Plans', audience: 'Private product discussion', routingVersion: 'first', unclassified: false } }
    route.query = { product: 'plans' }
    fetcher.mockResolvedValueOnce(catalog).mockRejectedValueOnce({ statusCode: 409 })
    const wrapper = mount(IssueReport, { global })
    await flushPromises()
    expect(fetcher.mock.calls[0]![1].query.product).toBe('plans')
    await wrapper.get('input').setValue('Keep this report')
    await wrapper.get('textarea').setValue('Full reproduction')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.text()).toContain('destination changed')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(fetcher).toHaveBeenCalledTimes(2)
    fetcher.mockResolvedValueOnce({ ...catalog, selected: { ...catalog.selected, routingVersion: 'second' } })
    await wrapper.findAll('button').find(b => b.text() === 'Review current destination')!.trigger('click'); await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('Full reproduction')
    fetcher.mockResolvedValueOnce({ stableUrl: '/i/one' })
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(fetcher.mock.calls[3]![1].body).toMatchObject({ title: 'Keep this report', body: 'Full reproduction', routingVersion: 'second' })
    expect(navigate).toHaveBeenCalledWith('/i/one')
  })
  it('ignores an older product response after the reporter changes product', async () => {
    let resolveFirst!: (value: unknown) => void
    fetcher.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    const wrapper = mount(IssueReport, { global })
    fetcher.mockResolvedValueOnce({ products: [], selected: { key: 'git', name: 'Git', audience: 'Private', routingVersion: 'new' } })
    route.query = { product: 'git' }
    await flushPromises()
    resolveFirst({ products: [], selected: { key: 'plans', name: 'Plans', audience: 'Private', routingVersion: 'old' } })
    await flushPromises()
    expect(wrapper.text()).toContain('Git — private development discussion')
    expect(wrapper.text()).not.toContain('Plans — private development discussion')
  })

  it('retains policy edits on conflict and sends the displayed revision', async () => {
    fetcher.mockResolvedValueOnce({ reportingEnabled: false, version: 3, products: [], canCreateProduct: false }).mockRejectedValueOnce({ statusCode: 409 })
    const wrapper = mount(IssuePolicy, { props: { owner: 'owner', name: 'project' }, global })
    await flushPromises()
    expect(wrapper.text()).not.toContain('Register product')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(fetcher.mock.calls[1]![1].body).toEqual({ reportingEnabled: true, expectedVersion: 3 })
    expect(wrapper.get('input[type="checkbox"]').element.checked).toBe(true)
    expect(wrapper.text()).toContain('record changed')
  })
  it('transfers an intake report only with explicit label disposition and its current revision', async () => {
    fetcher.mockResolvedValueOnce({ products: [{ key: 'plans', name: 'Plans', labels: [] }] }).mockResolvedValueOnce({})
    const wrapper = mount(IssueTriage, { props: { issue: { ...record, triageState: 'unclassified', labels: [{ id: 'old', name: 'triage' }] } as never, endpoint: '/api/issue-records/issue-a' }, global: { ...global, stubs: { ...global.stubs, IssueTriage: false } } })
    await flushPromises()
    const choices = wrapper.findAll('select')
    await choices[0]!.setValue('plans')
    await choices[1]!.setValue('remove')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(fetcher.mock.calls[1]![1].body).toEqual({ productKey: 'plans', labelMap: { old: null }, expectedVersion: 1 })
    expect(wrapper.emitted('changed')).toHaveLength(1)
    await wrapper.setProps({ issue: { ...record, triageState: 'classified' } as never })
    expect(wrapper.text()).not.toContain('Classify / transfer report')
  })

  it('renders current PR state and permits explicit linking without closing the issue', async () => {
    const pull = { id: 'pull', title: 'Fix context', number: 7, state: 'merged', owner: 'owner', name: 'project', url: '/owner/project/pulls/7' }
    fetcher.mockResolvedValueOnce({ pulls: [] }).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ pulls: [pull] })
    const wrapper = mount(IssuePullLinks, { props: { endpoint: '/api/issue-records/issue-a', canLink: true }, global: { ...global, stubs: { ...global.stubs, IssuePullLinks: false } } })
    await flushPromises()
    await wrapper.get('input[aria-label="Pull request repository"]').setValue('owner/project')
    await wrapper.get('input[aria-label="Pull request number"]').setValue('7')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(fetcher.mock.calls[1]![1].body).toEqual({ repository: 'owner/project', number: 7 })
    expect(wrapper.get('a').attributes('href')).toBe(pull.url)
    expect(wrapper.text()).toContain('merged')
    expect(fetcher.mock.calls.some(call => call[1]?.method === 'PATCH')).toBe(false)
    await wrapper.setProps({ canLink: false })
    expect(wrapper.text()).not.toContain('Unlink')
    expect(wrapper.find('form').exists()).toBe(false)
  })
  it('shows reciprocal issue links and an explicit read failure without disabling PR controls', async () => {
    fetcher.mockResolvedValueOnce({ issues: [{ id: 'one', title: 'Problem', url: '/i/one', state: 'open' }] })
    const wrapper = mount(PullIssueLinks, { props: { endpoint: '/api/repos/owner/project/pulls/7' }, global })
    await flushPromises()
    expect(wrapper.get('a').attributes('href')).toBe('/i/one')
    expect(wrapper.text()).toContain('Related · open')
    wrapper.unmount()
    fetcher.mockRejectedValueOnce({ statusCode: 403 })
    const denied = mount(PullIssueLinks, { props: { endpoint: '/api/repos/owner/project/pulls/7' }, global })
    await flushPromises()
    expect(denied.text()).toContain('access has changed')
    expect(denied.find('a').exists()).toBe(false)
  })
  it('labels an external issue home and hides native code and pull tabs', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { issuesEnabled: true } }))
    fetcher.mockResolvedValueOnce({ issueHomeOnly: 1, codeSourceUrl: 'https://code.example/source' })
    const wrapper = mount(RepoHeader, { props: { owner: 'owner', name: 'external', tab: 'issues' }, global: { ...global, stubs: { ...global.stubs, RepoHeader: false } } })
    await flushPromises()
    expect(wrapper.get('a[href="https://code.example/source"]').text()).toBe('View external code')
    expect(wrapper.text()).toContain('Issues')
    expect(wrapper.text()).not.toContain('Commits')
    expect(wrapper.text()).not.toContain('Pulls')
    expect(wrapper.find('a[href="/owner/external"]').exists()).toBe(false)
  })

})
