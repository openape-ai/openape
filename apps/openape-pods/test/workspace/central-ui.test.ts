import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import CentralWorkspace from '../../src/renderer/central/CentralWorkspace.vue'
import { WorkspaceRequestError } from '../../src/renderer/central/client'
import { centralFixture } from './central-fixture'

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined })
async function open() {
  const fixture = centralFixture()
  wrapper = mount(CentralWorkspace, { props: { client: fixture.client } })
  await flushPromises()
  await wrapper.find('.central-pod').trigger('click'); await flushPromises()
  return fixture
}
it('hides open content when the Pod goes offline and disables opening offline Pods', async () => {
  const fixture = await open()
  expect(wrapper!.text()).toContain('What this Pod does')
  expect(wrapper!.findAll('.central-pod')[1]!.attributes('disabled')).toBeDefined()
  fixture.host.workspace.pods[0]!.online = false; fixture.wake(); await flushPromises()
  expect(wrapper!.text()).toContain('This Pod is offline')
  expect(wrapper!.find('[aria-label="Pod description"]').exists()).toBe(false)
  expect(wrapper!.text()).not.toContain('All checks completed')
})
it('keeps an unsaved draft after a revision conflict and does not retry it', async () => {
  const fixture = await open()
  fixture.client.command = vi.fn(async () => { throw new WorkspaceRequestError(409, 'workspace_revision_conflict') })
  await wrapper!.find('[aria-label="Pod description"]').setValue('My unfinished edit')
  await wrapper!.findAll('button').find(item => item.text() === 'Save description')!.trigger('click'); await flushPromises()
  expect(wrapper!.find('[role="alert"]').text()).toContain('workspace_revision_conflict')
  expect((wrapper!.find('textarea').element as HTMLTextAreaElement).value).toBe('My unfinished edit')
  expect(fixture.client.command).toHaveBeenCalledOnce()
})
it('retains an operation identity when the request acknowledgement is lost', async () => {
  const fixture = await open()
  fixture.client.command = vi.fn(async () => { throw new TypeError('Connection lost') })
  await wrapper!.findAll('button').find(item => item.text() === 'Save description')!.trigger('click'); await flushPromises()
  expect(wrapper!.text()).toContain('Check pending operation')
  expect(wrapper!.find('fieldset').attributes('disabled')).toBeDefined()
  expect(fixture.client.command).toHaveBeenCalledOnce()
})
