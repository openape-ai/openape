import { randomUUID } from 'node:crypto'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import type { ResourceCommand, ResourceState } from '../../src/contracts/resources'
import type { SandboxView } from '../../src/contracts/sandbox'
import PodResources from '../../src/renderer/PodResources.vue'
import SandboxDenylist from '../../src/renderer/SandboxDenylist.vue'
import { applyLanguage } from '../../src/renderer/i18n'

const networkId = '00000000-0000-4000-8000-000000000002'
function view(own: string[], level: SandboxView['level'] = 'owner'): SandboxView {
  return {
    level,
    sources: [{ source: 'pod', level }],
    deny: [...new Set([...own, '~/Library/LaunchAgents'])],
    denySources: [{ source: `network:${networkId}`, deny: ['~/Library/LaunchAgents'] }, ...(own.length ? [{ source: 'pod', deny: own }] : [])],
  }
}
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; applyLanguage('en') })
const button = (label: string) => wrapper!.findAll('button').find(item => item.attributes('aria-label') === label || item.text().trim() === label)

it('shows the level and the denied paths and edits only the Pod\'s own entries', async () => {
  applyLanguage('de')
  wrapper = mount(SandboxDenylist, { props: { sandbox: view(['~/.ssh']), busy: false } })
  expect(wrapper.text()).toContain('Stufe Owner: Programme erreichen, was du auf diesem Mac erreichst, außer den Pods-Daten und deinem apes-Login.')
  expect(wrapper.findAll('.deny-path').map(item => item.text())).toEqual(['~/.ssh', '~/Library/LaunchAgentsVon einem Netzwerk gesperrt'])
  // A network entry is shown but cannot be removed from the Pod.
  expect(wrapper.findAll('.deny-row button.text-button')).toHaveLength(1)
  await button('~/.ssh wieder erlauben')!.trigger('click')
  expect(wrapper.emitted('save')).toEqual([[[]]])

  await wrapper.get('input').setValue('/Users/owner/private/')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('save')!.at(-1)).toEqual([['~/.ssh', '/Users/owner/private']])
  expect((wrapper.get('input').element as HTMLInputElement).value).toBe('')
})

it('refuses relative, wildcard and parent paths with a translated message', async () => {
  applyLanguage('de')
  wrapper = mount(SandboxDenylist, { props: { sandbox: view([], 'isolated'), busy: false } })
  expect(wrapper.text()).toContain('Stufe isoliert')
  for (const path of ['Documents', '~/*.pem', '/Users/owner/../other']) {
    await wrapper.get('input').setValue(path)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toBe('Ein gesperrter Pfad ist absolut oder beginnt mit ~/, ohne Platzhalter')
  }
  expect(wrapper.emitted('save')).toBeUndefined()
  await wrapper.setProps({ readonly: true })
  expect(wrapper.find('form').exists()).toBe(false)
})

it('loads the sandbox with the desktop permissions and saves the Pod denylist', async () => {
  const podId = randomUUID()
  const state = (deny: string[]): ResourceState => ({ resources: [], epoch: 1, sandbox: view(deny) })
  const resources = vi.fn(async (command: ResourceCommand) => command.type === 'saveSandboxDeny' ? state(command.deny) : state([]))
  window.pods = { workspace: async () => ({ pods: [{ id: podId, name: 'One' }] }), resources } as unknown as typeof window.pods
  wrapper = mount(PodResources, { props: { selectedPodId: podId }, global: { stubs: { ProgramPermissions: true, SshPermissions: true } } }); await flushPromises()
  expect(resources).toHaveBeenCalledWith({ type: 'sandbox', podId })
  await wrapper.get('.deny-list input').setValue('~/.ssh')
  await wrapper.get('.deny-list form').trigger('submit'); await flushPromises()
  expect(resources).toHaveBeenLastCalledWith({ type: 'saveSandboxDeny', podId, deny: ['~/.ssh'] })
  expect(wrapper.findAll('.deny-path').map(item => item.text())).toContain('~/.ssh')
})
