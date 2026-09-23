import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import App from '../../src/renderer/App.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import type { PodsBridge } from '../../src/contracts/ipc'
import type { ResourceState } from '../../src/contracts/resources'
import type { RunView } from '../../src/contracts/runs'
import type { ScriptView } from '../../src/contracts/scripts'
import { installWorkspace, podId, pods } from './workspace-fixture'

// Geometry formerly asserted by the packaged `values-tab`, `credentials`,
// `readable-runs`, `script-editor`, `terminal-feedback`, `dependencies` and
// `programs` E2E files. Behaviour of the same tabs lives in test/workspace,
// test/programs and test/credentials; native execution stays in e2e/.
const frame = () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
const artifact = (name: string) => `../../.artifacts/${name}`
const hash = 'a'.repeat(64)
let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount(); wrapper = undefined; document.documentElement.style.colorScheme = ''; applyLanguage('en')
  try { localStorage.clear() }
  catch {}
})

async function openTab(tab: string, overrides: Partial<PodsBridge> = {}) {
  installWorkspace({ programs: async command => command.type === 'launchStatus' ? null : Promise.reject(new Error('Sign in with your DDISA account before setting up a pod')), ...overrides })
  wrapper = mount(App, { attachTo: document.body }); await flushPromises()
  await wrapper.findAll('[role="tab"]').find(item => item.text() === tab)!.trigger('click'); await flushPromises(); await frame()
}
async function show(width: number, height: number, scheme: 'light' | 'dark' = 'light') {
  await page.viewport(width, height); document.documentElement.style.colorScheme = scheme; await frame()
}
function content() { const element = document.querySelector('.content')!; return element.scrollWidth - element.clientWidth }
const pageFits = () => document.documentElement.scrollWidth <= innerWidth

describe('pod tabs with the production stylesheet', () => {
  it('keeps value rows and a long secret alias readable in a narrow dark window', async () => {
    const alias = 'a'.repeat(64)
    const resources: ResourceState = { epoch: 2, variables: [{ name: 'application_id', value: '', revision: 1 }, { name: 'chat_id', value: '', revision: 1 }], resources: [{ id: '00000000-0000-4000-8000-000000000031', podId, revision: 1, kind: 'credential', state: 'ready', name: alias, configuration: { alias, credentialId: '00000000-0000-4000-8000-000000000032' } }] }
    const script: ScriptView = { resourceEpoch: 2, credentialAliases: [alias], pod: pods[0]!, versions: [], drafts: [], source: { kind: 'version', id: hash, code: 'export async function run() {}', capabilities: [`credential.${alias}`, 'credential.notification_token'], revision: 1, assignmentRevision: 1, hash, validated: true, evidence: null, credentialAccessApproved: true } }
    await openTab('Variables and secrets', { resources: async () => structuredClone(resources), scripts: async () => structuredClone(script) })
    await show(560, 840, 'dark')
    expect(pageFits()).toBe(true)
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.value-row > div'))
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.getBoundingClientRect().width).toBeGreaterThan(160)
    const access = document.querySelector<HTMLElement>('.script-access')!
    access.scrollIntoView()
    expect(content(), 'long alias').toBeLessThanOrEqual(0)
    // Counter-check: a fieldset that cannot shrink does overflow the content.
    access.style.minWidth = '1200px'
    expect(content()).toBeGreaterThan(0)
    access.style.removeProperty('min-width')
  })

  it('keeps persisted run explanations and a pending approval inside 680 and 600 pixel windows', async () => {
    const view: RunView = {
      runs: [
        { id: '00000000-0000-4000-8000-000000000041', podId, scriptHash: hash, state: 'running', startedAt: 1_790_000_100_000, finishedAt: null, summary: '', error: null, checkpointRevision: 0, recovery: null },
        { id: '00000000-0000-4000-8000-000000000042', podId, scriptHash: hash, state: 'cancelled', startedAt: 1_790_000_000_000, finishedAt: 1_790_000_065_000, summary: '', error: 'Data inventory contains a link or unsupported file: runs/fixture/agent/confined/home/codex/tmp/arg0/fixture/apply_patch', checkpointRevision: 0, recovery: null },
      ],
      events: [],
      approvals: [{ runId: '00000000-0000-4000-8000-000000000041', grantId: 'synthetic-grant', issuer: 'https://id.example.test', subject: 'pod@example.test', state: 'pending', title: 'Run the stored script of Mail knowledge', permission: `pod-runtime.pod[id=${podId}]#run`, openError: 'The browser could not be opened; use Open approval to try again' }],
    } as RunView
    applyLanguage('de')
    await openTab('Historie', { runs: async () => structuredClone(view) })
    expect(document.querySelector('.approval-card')).not.toBeNull()
    for (const width of [680, 600]) {
      await show(width, 850)
      expect(pageFits(), `${width}: page overflow`).toBe(true)
      expect(content(), `${width}: content overflow`).toBeLessThanOrEqual(1)
    }
  })

  it('keeps a long script inside a bounded editor and the Script tab inside a narrow dark window', async () => {
    const script: ScriptView = { resourceEpoch: 0, credentialAliases: [], pod: pods[0]!, versions: [], drafts: [], source: { kind: 'version', id: hash, code: '// long script line\n'.repeat(1000), capabilities: [], revision: 1, assignmentRevision: 1, hash, validated: true, evidence: null, credentialAccessApproved: true } }
    await openTab('Script', { scripts: async () => structuredClone(script) })
    await show(1060, 850)
    expect(document.querySelector('.code-editor')!.getBoundingClientRect().height).toBeLessThan(500)
    await show(560, 840, 'dark')
    expect(pageFits()).toBe(true)
  })

  it('places terminal feedback beside its button and keeps permissions readable in English and narrow dark German', async () => {
    const resources: ResourceState = {
      epoch: 3, directories: { home: '/Users/fixture/Library/Application Support/OpenApe Pods/pods/pod/home', workspace: '/Users/fixture/Library/Application Support/OpenApe Pods/pods/pod/workspace' },
      resources: [
        { id: '00000000-0000-4000-8000-000000000051', podId, revision: 1, kind: 'directory', state: 'ready', name: 'Invoices', configuration: { path: '/Users/fixture/Documents/Customers/Northwind Trading Company/Invoices/2026', access: 'read' } },
        { id: '00000000-0000-4000-8000-000000000052', podId, revision: 1, kind: 'tool', state: 'ready', name: 'Synthetic application', configuration: { type: 'program', executable: '/Applications/Synthetic Application.app/Contents/MacOS/synthetic', grants: [{ permission: 'read', display: 'Read assigned data' }] } },
        { id: '00000000-0000-4000-8000-000000000053', podId, revision: 1, kind: 'tool', state: 'ready', name: 'https://api.example.com', configuration: { type: 'http', origin: 'https://api.example.com', methods: ['GET', 'POST'] } },
      ],
    }
    await openTab('Permissions', { resources: async () => structuredClone(resources) })
    await show(1060, 950)
    const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent!.trim() === 'Open Terminal.app')!
    button.click(); await flushPromises(); await frame()
    const alert = document.querySelector('.program-permissions [role="alert"]')!
    expect(alert.textContent).toContain('DDISA')
    const offset = alert.getBoundingClientRect().top - button.getBoundingClientRect().top
    expect(offset, 'feedback directly below the button').toBeGreaterThan(0)
    expect(offset).toBeLessThan(90)
    const heading = document.querySelector('.http-heading')!
    expect(heading.getBoundingClientRect().top - heading.previousElementSibling!.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(34)
    await page.screenshot({ path: artifact('program-permissions-en.png'), element: document.querySelector('.application-card')! })
    await page.screenshot({ path: artifact('external-terminal-en.png'), element: document.querySelector('.program-permissions')! })
    await page.screenshot({ path: artifact('program-http-en.png'), element: document.querySelector('.http-list')! })
    wrapper!.unmount(); applyLanguage('de')
    await openTab('Berechtigungen', { resources: async () => structuredClone(resources) })
    await show(560, 800, 'dark')
    expect(pageFits()).toBe(true)
    expect(document.querySelector('.directory-select .directory-label')!.getBoundingClientRect().width).toBeGreaterThan(120)
    await page.screenshot({ path: artifact('program-permissions-de-dark.png'), element: document.querySelector('.application-card')! })
    await page.screenshot({ path: artifact('external-terminal-de-dark.png'), element: document.querySelector('.program-permissions')! })
  })
})
