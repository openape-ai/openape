import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import type { Organization } from '../../src/contracts/groups'
import type { ResourceState } from '../../src/contracts/resources'
import type { PortableImportView, SharingCommand, SharingState } from '../../src/contracts/sharing'
import SharingExport from '../../src/renderer/SharingExport.vue'
import SharingImport from '../../src/renderer/SharingImport.vue'
import { applyLanguage } from '../../src/renderer/i18n'

afterEach(() => applyLanguage('en'))
const manifest = {
  format: 'openape-package', version: 1, package: { key: 'fixture', revision: 2, title: 'Morning briefing', description: 'Reads mail and summarizes it' }, requiredFeatures: ['portable_aliases_v1'], entry: { kind: 'sequence', key: 'flow' }, applications: [], files: [], contentSha256: 'a'.repeat(64),
  pods: [{ key: 'reader', title: 'Reader', description: '', script: 'pods/reader/run.mjs', packages: null, contract: null, requestedCapabilities: ['tool.api.request'], access: [{ kind: 'http', alias: 'api', origin: 'input_2', methods: ['GET'], authentication: null }], inputs: [{ key: 'input_1', label: 'greeting', description: 'Shown first', kind: 'string', required: true, sharingGroup: null }, { key: 'input_2', label: 'api origin', description: '', kind: 'string', required: true, sharingGroup: null, default: 'https://api.example.test' }], bindings: [{ alias: 'greeting', input: 'input_1' }], applications: [], assets: [] }],
  compositions: [{ key: 'flow', kind: 'sequence', title: 'Briefing flow', document: 'compositions/flow.json', documentVersion: 1, nodes: [{ pod: 'reader', after: [], handoff: false }], calls: [], inputs: [], dataSchemas: [] }],
} as unknown as PortableImportView['manifest']
function importView(state: PortableImportView['state'], unresolved: PortableImportView['unresolved'], revision = 1): PortableImportView {
  return { id: '11111111-1111-4111-8111-111111111111', state, revision, transferSha256: 'b'.repeat(64), manifest, pods: state === 'staged' ? [] : [{ key: 'reader', podId: '22222222-2222-4222-8222-222222222222' }], compositions: [], deferred: [], values: { pods: {}, compositions: {} }, unresolved, error: null }
}
const organization: Organization = { revision: 1, groups: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Delta', collapsed: false, podIds: [] }] }

it('drives an import from the opened file through values, the paused copy, binding, composition and completion', async () => {
  let current = importView('staged', [{ scope: 'pod', key: 'reader', requirement: 'value', name: 'input_1' }, { scope: 'pod', key: 'reader', requirement: 'access', name: 'api' }, { scope: 'composition', key: 'flow', requirement: 'composition', name: null }])
  let opened = false
  const api = vi.fn(async (command: SharingCommand): Promise<SharingState> => {
    if (command.scope === 'import' && command.type === 'list') return { imports: opened && current.state !== 'completed' ? [current] : [] }
    if (command.scope === 'import' && command.type === 'pickFile') { opened = true; return { imports: [current], current } }
    if (command.scope === 'import' && command.type === 'configure') { current = { ...current, revision: 2, values: command.values, unresolved: current.unresolved.filter(item => item.requirement !== 'value') }; return { imports: [current], current } }
    if (command.scope === 'import' && command.type === 'commit') { current = { ...importView('committed', current.unresolved, 3), values: current.values }; return { imports: [current], current } }
    if (command.scope === 'import' && command.type === 'bind') { current = { ...current, revision: 4, unresolved: current.unresolved.filter(item => item.requirement !== 'access') }; return { imports: [current], current } }
    if (command.scope === 'import' && command.type === 'finalize') { current = { ...current, revision: 5, compositions: [{ key: 'flow', workflowId: '44444444-4444-4444-8444-444444444444', networkId: null }], unresolved: [] }; return { imports: [current], current } }
    if (command.scope === 'import' && command.type === 'complete') { current = { ...current, state: 'completed', revision: 6 }; return { imports: [], current } }
    throw new Error(`Unexpected ${command.scope} ${command.type}`)
  })
  const resources = vi.fn(async () => ({ epoch: 1, resources: [{ id: '55555555-5555-4555-8555-555555555555', podId: '22222222-2222-4222-8222-222222222222', revision: 1, kind: 'tool', state: 'ready', name: 'https://api.example.test', configuration: { type: 'http', origin: 'https://api.example.test', methods: ['GET'], capability: 'tool.http_x.request' } }] }) as unknown as ResourceState)
  const wrapper = mount(SharingImport, { props: { api, organization, desktop: true, resources } })
  await flushPromises()
  const button = (label: string) => wrapper.findAll('button').find(item => item.text() === label)!
  expect(wrapper.text()).toContain('No import is in progress')
  await button('Open package…').trigger('click'); await flushPromises()
  expect(api).toHaveBeenCalledWith({ scope: 'import', type: 'pickFile' })
  expect(wrapper.text()).toContain('Morning briefing'); expect(wrapper.text()).toContain('Reviewing')
  const greeting = wrapper.findAll('input').find(input => input.attributes('type') === 'text')!
  await greeting.setValue('hello'); await button('Save values').trigger('click'); await flushPromises()
  expect(api).toHaveBeenCalledWith({ scope: 'import', type: 'configure', id: current.id, revision: 1, values: { pods: { reader: { input_1: 'hello' } }, compositions: {} } })
  await button('Create paused copy').trigger('click'); await flushPromises()
  expect(api).toHaveBeenCalledWith(expect.objectContaining({ type: 'commit', revision: 2 }))
  expect(wrapper.text()).toContain('Access api')
  expect(wrapper.findAll('button').find(item => item.text() === 'Finish setup')!.attributes('disabled')).toBeDefined()
  expect(resources).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222')
  const select = wrapper.find('select[aria-label="Assignment for api"]')
  expect((select.element as HTMLSelectElement).selectedOptions[0]?.text.trim()).toBe('Choose an assignment')
  await select.setValue('55555555-5555-4555-8555-555555555555'); await button('Bind').trigger('click'); await flushPromises()
  expect(api).toHaveBeenCalledWith({ scope: 'import', type: 'bind', id: current.id, revision: 3, pod: 'reader', alias: 'api', resourceId: '55555555-5555-4555-8555-555555555555', bundle: null })
  await button('Create composition').trigger('click'); await flushPromises()
  expect(api).toHaveBeenCalledWith({ scope: 'import', type: 'finalize', id: current.id, revision: 4, composition: 'flow', groupId: null, reuse: {} })
  expect(wrapper.text()).toContain('Created and disabled')
  await button('Finish setup').trigger('click'); await flushPromises()
  expect(api).toHaveBeenCalledWith(expect.objectContaining({ type: 'complete', revision: 5 }))
  expect(wrapper.text()).toContain('Setup finished')
})

it('keeps file transfer on the desktop and lets a browser review and configure', async () => {
  const current = importView('staged', [])
  const api = vi.fn(async (): Promise<SharingState> => ({ imports: [current] }))
  const wrapper = mount(SharingImport, { props: { api, organization, desktop: false } })
  await flushPromises()
  expect(wrapper.findAll('button').some(item => item.text() === 'Open package…')).toBe(false)
  expect(wrapper.text()).toContain('Open the package file on the connected desktop')
  expect(wrapper.findAll('button').some(item => item.text() === 'Create paused copy')).toBe(true)
})

it('reviews an export with explicit file and alias choices and saves it only after acknowledging findings', async () => {
  const selection = { kind: 'pod' as const, id: '22222222-2222-4222-8222-222222222222' }
  const api = vi.fn(async (command: SharingCommand): Promise<SharingState> => {
    if (command.scope === 'export' && command.type === 'inspectSource') return { imports: [], source: { selection, pods: [{ podId: selection.id, name: 'Reader', references: [{ id: '66666666-6666-4666-8666-666666666666', name: 'template.txt' }], aliasable: [{ id: '55555555-5555-4555-8555-555555555555', kind: 'http', name: 'api.example.test' }], variables: ['greeting'], configuration: [] }], compositions: [] } }
    if (command.scope === 'export' && command.type === 'review') return { imports: [], review: { id: '77777777-7777-4777-8777-777777777777', manifest: { ...manifest, files: [{ path: 'pods/reader/run.mjs', kind: 'script', bytes: 120, sha256: 'c'.repeat(64), mediaType: 'text/javascript' }] }, findings: [{ id: 'finding-1', path: 'pods/reader/run.mjs', line: 3, kind: 'possible-credential', severity: 'review' }], expiresAt: Date.now() + 600000 } }
    if (command.scope === 'export' && command.type === 'download') return { imports: [], saved: '/Users/owner/Downloads/reader.openape' }
    if (command.scope === 'export' && command.type === 'discard') return { imports: [] }
    throw new Error(`Unexpected ${command.scope} ${command.type}`)
  })
  const wrapper = mount(SharingExport, { props: { selection, api, desktop: true } })
  await flushPromises()
  const button = (label: string) => wrapper.findAll('button').find(item => item.text() === label)!
  expect(wrapper.text()).toContain('Include template.txt')
  await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true)
  await button('Review package').trigger('click'); await flushPromises()
  const review = api.mock.calls.find(([command]) => command.type === 'review')![0] as Extract<SharingCommand, { type: 'review' }>
  expect(review.choices.pods[0]).toMatchObject({ podId: selection.id, key: 'reader', assets: [{ resourceId: '66666666-6666-4666-8666-666666666666', path: 'assets/reader/template.txt' }], omittedReferences: [], aliases: [{ resourceId: '55555555-5555-4555-8555-555555555555', alias: 'api_example_test' }], defaults: [] })
  expect(wrapper.text()).toContain('pods/reader/run.mjs'); expect(wrapper.text()).toContain('Possible credential')
  expect(button('Save package…').attributes('disabled')).toBeDefined()
  await wrapper.find('.sharing-findings input[type="checkbox"]').setValue(true)
  expect(button('Save package…').attributes('disabled')).toBeUndefined()
  await button('Save package…').trigger('click'); await flushPromises()
  expect(api).toHaveBeenCalledWith({ scope: 'export', type: 'download', id: '77777777-7777-4777-8777-777777777777', acknowledgedFindings: ['finding-1'] })
  expect(api).toHaveBeenCalledWith({ scope: 'export', type: 'discard', id: '77777777-7777-4777-8777-777777777777' })
  expect(wrapper.text()).toContain('Package saved to /Users/owner/Downloads/reader.openape')
  expect(wrapper.emitted('done')).toHaveLength(1)
})

it('waits for approved members before deferred compositions and confirms abandoning them', async () => {
  let current: PortableImportView = { ...importView('completed', [{ scope: 'composition', key: 'flow', requirement: 'composition', name: null }], 4), deferred: ['flow'] }
  const api = vi.fn(async (command: SharingCommand): Promise<SharingState> => {
    if (command.scope === 'import' && command.type === 'cancel') { current = { ...current, revision: 5, unresolved: [] }; return { imports: [], current } }
    return { imports: [current] }
  })
  const wrapper = mount(SharingImport, { props: { api, organization, desktop: true } })
  await flushPromises()
  const button = (label: string) => wrapper.findAll('button').find(item => item.text() === label)!
  expect(wrapper.text()).toContain('Finishing compositions')
  expect(button('Create composition')).toBeDefined()
  await button('Abandon remaining compositions').trigger('click'); await flushPromises()
  expect(api).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'cancel' }))
  expect(wrapper.text()).toContain('Abandoning is final')
  await button('Abandon now').trigger('click'); await flushPromises()
  expect(api).toHaveBeenCalledWith({ scope: 'import', type: 'cancel', id: current.id, revision: 4 })
  expect(wrapper.text()).toContain('No import is in progress')
})
