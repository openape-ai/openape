import { screenshotPath } from './evidence'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import type { PortableImportView, SharingCommand, SharingState } from '../../src/contracts/sharing'
import SharingExport from '../../src/renderer/SharingExport.vue'
import SharingImport from '../../src/renderer/SharingImport.vue'
import { applyLanguage } from '../../src/renderer/i18n'

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; applyLanguage('en'); document.documentElement.style.colorScheme = '' })
const manifest = {
  format: 'openape-package', version: 1, package: { key: 'briefing', revision: 3, title: 'Morning briefing', description: 'Reads the inbox, summarizes new mail and posts the summary.' }, requiredFeatures: ['portable_aliases_v1'], entry: { kind: 'sequence', key: 'flow' }, applications: [], files: [{ path: 'pods/reader/run.mjs', kind: 'script', bytes: 2048, sha256: 'c'.repeat(64), mediaType: 'text/javascript' }, { path: 'assets/reader/template.md', kind: 'asset', bytes: 410, sha256: 'd'.repeat(64), mediaType: 'text/markdown' }], contentSha256: 'a'.repeat(64),
  pods: [{ key: 'reader', title: 'Inbox reader', description: '', script: 'pods/reader/run.mjs', packages: null, contract: null, requestedCapabilities: ['tool.api.request'], access: [{ kind: 'http', alias: 'api', origin: 'input_2', methods: ['GET'], authentication: null }, { kind: 'directory', alias: 'archive', input: 'input_3', access: 'read' }], inputs: [{ key: 'input_1', label: 'greeting', description: 'Shown at the top of the summary', kind: 'string', required: true, sharingGroup: null }, { key: 'input_2', label: 'api origin', description: '', kind: 'string', required: true, sharingGroup: null, default: 'https://api.example.test' }, { key: 'input_3', label: 'archive folder', description: '', kind: 'directory', required: true, sharingGroup: null }, { key: 'input_4', label: 'limit', description: 'Mails per run', kind: 'number', required: true, sharingGroup: null, minimum: 1, maximum: 50, default: 10 }], bindings: [{ alias: 'greeting', input: 'input_1' }, { alias: 'limit', input: 'input_4' }], applications: [], assets: ['assets/reader/template.md'] }],
  compositions: [{ key: 'flow', kind: 'sequence', title: 'Briefing flow', document: 'compositions/flow.json', documentVersion: 1, nodes: [{ pod: 'reader', after: [], handoff: false }], calls: [], inputs: [], dataSchemas: [] }],
} as unknown as PortableImportView['manifest']
const committed: PortableImportView = { id: '11111111-1111-4111-8111-111111111111', state: 'committed', revision: 3, transferSha256: 'b'.repeat(64), manifest, pods: [{ key: 'reader', podId: '22222222-2222-4222-8222-222222222222' }], compositions: [], deferred: [], values: { pods: { reader: { input_1: 'Good morning' } }, compositions: {} }, unresolved: [{ scope: 'pod', key: 'reader', requirement: 'access', name: 'api' }, { scope: 'pod', key: 'reader', requirement: 'access', name: 'archive' }, { scope: 'composition', key: 'flow', requirement: 'composition', name: null }], error: null }
const organization = { revision: 1, groups: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Delta Mind', collapsed: false, podIds: [] }] }
async function settle(width: number) {
  await page.viewport(width, 1000)
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
}

it('renders the import setup at desktop and narrow widths in both languages without overflow', async () => {
  const api = async (): Promise<SharingState> => ({ imports: [committed] })
  wrapper = mount(SharingImport, { attachTo: document.body, props: { api, organization, desktop: true, resources: async () => ({ epoch: 1, resources: [] }) } })
  await flushPromises()
  expect(wrapper.text()).toContain('Access api')
  for (const width of [1280, 390]) { await settle(width); await page.screenshot({ path: screenshotPath(`sharing-import-${width}.png`) }) }
  applyLanguage('de'); document.documentElement.style.colorScheme = 'dark'; await flushPromises()
  await settle(390)
  expect(wrapper.text()).toContain('Zugriff api')
  await page.screenshot({ path: screenshotPath('sharing-import-de-dark-390.png') })
})

it('renders the export review with findings at desktop and narrow widths without overflow', async () => {
  const selection = { kind: 'pod' as const, id: '22222222-2222-4222-8222-222222222222' }
  const api = async (command: SharingCommand): Promise<SharingState> => {
    if (command.scope === 'export' && command.type === 'inspectSource') return { imports: [], source: { selection, pods: [{ podId: selection.id, name: 'Inbox reader', references: [{ id: '66666666-6666-4666-8666-666666666666', name: 'template.md' }], aliasable: [{ id: '55555555-5555-4555-8555-555555555555', kind: 'http', name: 'api.example.test' }], variables: ['greeting', 'limit'], configuration: [] }], compositions: [] } }
    return { imports: [], review: { id: '77777777-7777-4777-8777-777777777777', manifest, findings: [{ id: 'finding-1', path: 'pods/reader/run.mjs', line: 12, kind: 'possible-credential', severity: 'review' }], expiresAt: Date.now() + 600000 } }
  }
  wrapper = mount(SharingExport, { attachTo: document.body, props: { selection, api, desktop: true } })
  await flushPromises()
  await settle(1280); await page.screenshot({ path: screenshotPath('sharing-export-choices-1280.png') })
  await wrapper.findAll('button').find(item => item.text() === 'Review package')!.trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('Privacy findings')
  for (const width of [1280, 390]) { await settle(width); await page.screenshot({ path: screenshotPath(`sharing-export-review-${width}.png`) }) }
})
