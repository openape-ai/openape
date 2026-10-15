import { flushPromises } from '@vue/test-utils'
import { page, userEvent } from 'vitest/browser'
import { expect, it } from 'vitest'
import IssueBrowser from '../../app/components/IssueBrowser.vue'
import IssueCreate from '../../app/components/IssueCreate.vue'
import IssueDetail from '../../app/components/IssueDetail.vue'
import IssueEditor from '../../app/components/IssueEditor.vue'
import IssueList from '../../app/components/IssueList.vue'
import IssueReport from '../../app/components/IssueReport.vue'
import PullPage from '../../app/pages/[owner]/[name]/pulls/[number].vue'
import { layouts, markdown, navigation, owner, record, render, title, transport } from './fixture'

it('creates by keyboard, previews Markdown and retains the draft and retry key after failure', async () => {
  const { navigate } = navigation()
  let fail = true
  const fetcher = transport((path, options) => {
    if (path === '/api/issue-preview') return { bodyHtml: markdown }
    if (options.method === 'POST') {
      if (fail) throw new Error('offline')
      return record
    }
  })
  render(IssueCreate, { owner: 'owner', name: 'project' })
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title)
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill(record.body)
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect.element(page.getByRole('heading', { name: 'Expected behavior' })).toBeVisible()
  expect(fetcher).toHaveBeenCalledWith('/api/issue-preview', { method: 'POST', body: { body: record.body } })
  await layouts('new', () => {
    expect(getComputedStyle(document.querySelector('h1')!).fontSize).toBe('24px')
    expect(getComputedStyle(document.documentElement).getPropertyValue('--ui-primary').trim()).not.toBe('')
    expect(getComputedStyle(page.getByRole('button', { name: 'Create issue', exact: true }).element()).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(document.querySelector('.markdown-body pre')!).overflowX).toBe('auto')
  })
  await page.getByRole('button', { name: 'Create issue', exact: true }).element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText(/draft is kept/)).toBeVisible()
  expect(page.getByRole('textbox', { name: 'Title', exact: true }).element()).toHaveValue(title)
  fail = false
  await page.getByRole('button', { name: 'Create issue', exact: true }).click()
  await expect.poll(() => navigate.mock.calls).toEqual([[record.repositoryUrl]])
  const creates = fetcher.mock.calls.filter(([path]) => path.endsWith('/issues'))
  expect(creates).toHaveLength(2)
  expect(creates[0]![1]?.headers?.['Idempotency-Key']).toBeTruthy()
  expect(creates[0]![1]?.headers).toEqual(creates[1]![1]?.headers)
})

it('keeps the Markdown draft visible when preview authentication expires', async () => {
  transport(() => { throw Object.assign(new Error('Synthetic request failure'), { statusCode: 401 }) })
  render(IssueEditor, { modelValue: '**draft**' })
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect.element(page.getByText(/session expired/)).toBeVisible()
  await expect.element(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('**draft**')
  await layouts('preview-error')
})

it('comments, assigns labels and closes/reopens with metadata below discussion on phones', async () => {
  const { navigate } = navigation()
  let issue = structuredClone(record)
  const comments: { id: string, bodyHtml: string, authorSubject: string, createdAt: number }[] = []
  const fetcher = transport((path, options) => {
    if (path.endsWith('/comments')) {
      if (options.method === 'POST') {
        comments.push({ id: 'comment-a', bodyHtml: '<p>Confirmed on mobile. Ready for triage.</p>', authorSubject: owner, createdAt: 1 })
        return { anchor: '#comment-comment-a' }
      }
      return { comments: [...comments], next: null }
    }
    if (path === '/api/issue-records/issue-a') {
      if (options.method === 'PATCH') {
        issue = { ...issue, ...options.body, version: issue.version + 1, labels: options.body?.labels ? [{ id: 'bug', name: 'bug', color: '#f59e0b' }] : issue.labels }
      }
      return structuredClone(issue)
    }
    if (path.endsWith('/labels') && options.method === 'POST') return { id: 'bug' }
  })
  render(IssueDetail, { endpoint: '/api/issue-records/issue-a' })
  await page.getByRole('textbox', { name: 'Leave a comment', exact: true }).fill('Confirmed on mobile. Ready for triage.')
  await page.getByRole('button', { name: 'Comment', exact: true }).element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('Confirmed on mobile. Ready for triage.', { exact: true })).toBeVisible()
  expect(navigate).toHaveBeenCalledWith({ hash: '#comment-comment-a' })
  await page.getByText('Create label', { exact: true }).first().click()
  await page.getByRole('textbox', { name: 'Label name' }).fill('bug')
  await page.getByRole('button', { name: 'Create label', exact: true }).click()
  await page.getByRole('checkbox', { name: 'bug', exact: true }).click()
  await page.getByRole('combobox', { name: 'Assign to' }).selectOptions(owner)
  await page.getByRole('button', { name: 'Save metadata' }).click()
  await expect.poll(() => issue.assignee).toBe(owner)
  expect(fetcher.mock.calls.some(([, options]) => options?.method === 'PATCH' && options.body?.expectedVersion === 1 && (options.body.labels as string[])?.[0] === 'bug')).toBe(true)
  await layouts('detail', (width) => {
    const discussion = page.getByRole('region', { name: 'Discussion', exact: true }).element().getBoundingClientRect()
    const metadata = page.getByRole('complementary', { name: 'Issue details' }).element().getBoundingClientRect()
    if (width === 390) expect(metadata.top).toBeGreaterThan(discussion.bottom)
    else expect(metadata.left).toBeGreaterThan(discussion.right)
  })
  await page.getByRole('button', { name: 'Close issue', exact: true }).click()
  await page.getByRole('button', { name: 'Reopen issue', exact: true }).click()
  await expect.element(page.getByRole('button', { name: 'Close issue', exact: true })).toBeVisible()
  expect(issue.state).toBe('open')
})

it('retains an edit draft and offers explicit reload after a stale-version conflict', async () => {
  transport((_path, options) => { if (options.method === 'PATCH') throw Object.assign(new Error('Synthetic request failure'), { statusCode: 409 }) })
  render(IssueDetail, { endpoint: '/api/issue-records/issue-a' })
  await page.getByRole('button', { name: 'Edit issue', exact: true }).click()
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Unsaved title')
  await page.getByRole('button', { name: 'Save issue', exact: true }).click()
  await expect.element(page.getByRole('button', { name: 'Reload current version' })).toBeVisible()
  await expect.element(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Unsaved title')
  await layouts('edit-conflict')
})

it.each(['repository', 'overview'])('filters the %s and clears stale rows when access changes', async (view) => {
  const { route, push } = navigation()
  let denied = false
  transport((path, options) => {
    if (denied) throw Object.assign(new Error('Synthetic request failure'), { statusCode: 403 })
    if (path === '/api/issue-facets') return { repositories: [{ owner: 'owner', name: 'project' }], products: [{ key: 'plans', name: 'Plans' }], labels: [], assignees: [owner], canCreate: true }
    if (path.endsWith('/issues')) return { issues: options.query?.q ? [] : [record], total: options.query?.q ? 0 : 1, cursor: null }
  })
  render(IssueBrowser, view === 'repository' ? { owner: 'owner', name: 'project' } : {})
  await expect.element(page.getByRole('link', { name: title, exact: true })).toBeVisible()
  await layouts(view)
  await page.getByRole('textbox', { name: 'Search issues' }).fill('missing')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect.element(page.getByText('No issues match these filters.', { exact: true })).toBeVisible()
  expect(push).toHaveBeenCalledWith({ query: { cursor: undefined, q: 'missing' } })
  await layouts(`${view}-empty`)
  denied = true
  route.fullPath = '/issues?q=denied'
  await expect.element(page.getByText(/access has changed/)).toBeVisible()
  await expect.element(page.getByRole('link', { name: title, exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByRole('option', { name: 'owner/project', exact: true })).not.toBeInTheDocument()
})

it('exposes loading and empty result states with real list styles', async () => {
  const wrapper = render(IssueList, { issues: [], total: 0, loading: true })
  await expect.element(page.getByText('Loading issues…', { exact: true })).toBeVisible()
  await layouts('loading')
  await wrapper.setProps({ loading: false })
  await expect.element(page.getByText('No issues match these filters.', { exact: true })).toBeVisible()
})

it('keeps the selected product and draft until a changed audience has been reviewed', async () => {
  const { navigate } = navigation({ product: 'plans' })
  let version = 'first'
  const fetcher = transport((path) => {
    if (path === '/api/products') return { products: [{ key: 'plans', name: 'Plans' }], selected: { key: 'plans', name: 'Plans', audience: 'Private product discussion', routingVersion: version, unclassified: false } }
    if (path === '/api/reports') {
      if (version === 'first') throw Object.assign(new Error('Synthetic request failure'), { statusCode: 409 })
      return { stableUrl: '/i/report-a' }
    }
  })
  render(IssueReport)
  await page.getByRole('textbox', { name: 'What happened?' }).fill('Plans lost my selected product after login')
  await page.getByRole('textbox', { name: 'Expected and actual behavior', exact: true }).fill('Full reproduction')
  await expect.element(page.getByRole('combobox', { name: 'Product', exact: true })).toHaveValue('plans')
  await layouts('report')
  await page.getByRole('button', { name: 'Submit report', exact: true }).click()
  await expect.element(page.getByRole('button', { name: 'Submit report', exact: true })).toBeDisabled()
  await expect.element(page.getByRole('textbox', { name: 'Expected and actual behavior', exact: true })).toHaveValue('Full reproduction')
  version = 'second'
  await page.getByRole('button', { name: 'Review current destination' }).click()
  await page.getByRole('button', { name: 'Submit report', exact: true }).click()
  await expect.poll(() => navigate.mock.calls).toEqual([['/i/report-a']])
  expect(fetcher).toHaveBeenLastCalledWith('/api/reports', expect.objectContaining({ body: expect.objectContaining({ routingVersion: 'second', body: 'Full reproduction' }) }))
})

it('renders reciprocal merged pull links and explicitly unlinks without closing the issue', async () => {
  navigation()
  const pull = { id: 'pull', title: 'Preserve product context', number: 7, state: 'merged', owner: 'owner', name: 'project', url: '/owner/project/pulls/7' }
  let linked = false
  const fetcher = transport((path, options) => {
    if (path.endsWith('/pulls')) {
      if (options.method === 'POST') linked = true
      return { pulls: linked ? [pull] : [] }
    }
    if (options.method === 'DELETE') { linked = false; return {} }
    if (path === '/api/repos/owner/project/pulls/7') return { pull: { ...pull, sourceRef: 'fix-issue', targetRef: 'main', authorEmail: owner, bodyHtml: '', mergeSha: 'a'.repeat(40), mergedAt: 1, createdAt: 1 }, sourceSha: null, targetSha: 'b'.repeat(40), commits: [], files: [], comments: [], conflicts: [], mergeable: false, canMerge: false, canDeleteSource: false, truncated: false }
    if (path === '/api/repos/owner/project/pulls/7/issues') return { issues: [{ id: record.id, title, url: record.stableUrl, state: 'open' }] }
  })
  const wrapper = render(IssueDetail, { endpoint: '/api/issue-records/issue-a' })
  await page.getByText('Link pull request', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Pull request repository', exact: true }).fill('owner/project')
  await page.getByRole('spinbutton', { name: 'Pull request number', exact: true }).fill('7')
  await page.getByRole('button', { name: 'Add related pull request', exact: true }).click()
  await expect.element(page.getByRole('link', { name: pull.title, exact: true })).toHaveAttribute('href', pull.url)
  await expect.element(page.getByText(/Related.*merged/)).toBeVisible()
  await layouts('issue-linked')
  await page.getByRole('button', { name: 'Unlink Preserve product context', exact: true }).click()
  await expect.element(page.getByText('No visible links.', { exact: true })).toBeVisible()
  expect(fetcher.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false)
  wrapper.unmount()
  const mergedPage = render(PullPage)
  await expect.element(page.getByRole('link', { name: title, exact: true })).toHaveAttribute('href', record.stableUrl)
  await layouts('pull-linked')
  mergedPage.unmount()
  pull.state = 'open'
  render(PullPage)
  await expect.element(page.getByRole('link', { name: title, exact: true })).toHaveAttribute('href', record.stableUrl)
  await layouts('pull-linked-open')
})

it('shows an external issue home without native code and pull tabs', async () => {
  navigation()
  transport((path) => {
    if (path.endsWith('/metadata')) return { issueHomeOnly: 1, codeSourceUrl: 'https://code.example/owner/external' }
    if (path === '/api/issue-facets') return { repositories: [{ owner: 'owner', name: 'external' }], products: [], labels: [], assignees: [], canCreate: true }
    if (path.endsWith('/issues')) return { issues: [], total: 0, cursor: null }
  })
  render(IssueBrowser, { owner: 'owner', name: 'external' })
  await expect.element(page.getByRole('link', { name: 'View external code', exact: true })).toHaveAttribute('href', 'https://code.example/owner/external')
  await expect.element(page.getByRole('link', { name: 'Code', exact: true })).not.toBeInTheDocument()
  await expect.element(page.getByRole('link', { name: 'Pulls', exact: true })).not.toBeInTheDocument()
  await layouts('external-home')
})

it('renders imported attribution, protected attachment links and the migration fence', async () => {
  transport(path => path === '/api/issue-records/issue-a' ? { ...record, imported: { label: 'Imported from Forgejo: Ghost', sourceUrl: 'https://forgejo.example.test/team/repo/issues/7' }, attachments: [{ id: 'asset', filename: 'diagnostic.html', size: 7, url: '/api/issue-attachments/asset' }], capabilities: { ...record.capabilities, migrationLocked: true, edit: false, triage: false, comment: false } } : undefined)
  render(IssueDetail, { endpoint: '/api/issue-records/issue-a' })
  await expect.element(page.getByText(/Migration review/)).toBeVisible()
  await expect.element(page.getByRole('link', { name: 'diagnostic.html', exact: true })).toHaveAttribute('href', '/api/issue-attachments/asset')
  await expect.element(page.getByRole('textbox', { name: 'Leave a comment', exact: true })).not.toBeInTheDocument()
  await flushPromises()
  expect(document.body.textContent).toContain('Imported from Forgejo: Ghost')
  await layouts('imported')
})

it('shows participant discussion without repository metadata controls', async () => {
  transport(path => path === '/api/issue-records/issue-a' ? { ...record, number: null, repositoryUrl: null, capabilities: { repository: null, edit: false, triage: false, admin: false, comment: true } } : undefined)
  render(IssueDetail, { endpoint: '/api/issue-records/issue-a' })
  await expect.element(page.getByRole('textbox', { name: 'Leave a comment', exact: true })).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Save metadata', exact: true })).not.toBeInTheDocument()
  expect(document.body.textContent).not.toContain('owner/project')
  await layouts('participant')
})

it('loads the real Nuxt UI color tokens when light mode is selected', async () => {
  document.documentElement.classList.replace('dark', 'light')
  render(IssueEditor, { modelValue: 'Draft in light mode' })
  await expect.element(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('Draft in light mode')
  await layouts('editor-light', () => {
    expect(getComputedStyle(document.documentElement).getPropertyValue('--ui-bg').trim()).toBe('#fff')
  })
})
