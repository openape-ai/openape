import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import MailWorkflowSettings from '../../src/renderer/MailWorkflowSettings.vue'
import MailWorkflowReview from '../../src/renderer/MailWorkflowReview.vue'
import type { MailWorkflowConfiguration } from '../../src/contracts/mail-workflow'

const configuration: MailWorkflowConfiguration = { mailbox: 'owner@example.invalid', filterPodId: '00000000-0000-4000-8000-000000000001', notifyPodId: '00000000-0000-4000-8000-000000000002', applicationId: '00000000-0000-4000-8000-000000000003', telegramCredential: 'telegram_bot_token', telegramChatId: '12345', protectedPartners: [], rules: [], mode: 'preview' }
it('keeps partner edits and new rules explicit without modifying the saved configuration', async () => {
  window.pods = { resources: vi.fn().mockResolvedValue({ resources: [] }) } as unknown as typeof window.pods
  const wrapper = mount(MailWorkflowSettings, { props: { configuration, pods: [] } }); await flushPromises()
  await wrapper.get('textarea').setValue('person@trusted.invalid\n@company.invalid')
  const update = wrapper.emitted('update')!.at(-1)![0] as MailWorkflowConfiguration
  expect(update.protectedPartners).toEqual([{ kind: 'address', value: 'person@trusted.invalid' }, { kind: 'domain', value: 'company.invalid' }])
  expect(configuration.protectedPartners).toEqual([])
  await wrapper.findAll('button').find(button => button.text() === 'Add archive rule')!.trigger('click')
  expect((wrapper.emitted('update')!.at(-1)![0] as MailWorkflowConfiguration).rules[0]!.enabled).toBe(false)
  expect(wrapper.text()).toContain('Live automatic archiving remains blocked')
  wrapper.unmount()
})
it('shows every move and uncertain delivery and requires explicit reconciliation evidence', async () => {
  const batchId = '00000000-0000-4000-8000-000000000004'
  const review = { batchId, mailbox: configuration.mailbox, baseline: false, phase: 'reporting', items: [{ id: 'one', sender: 'digest@example.invalid', subject: 'First synthetic digest', disposition: 'archived', reason: 'Reviewed rule', receipt: { requestId: 'receipt-one' } }, { id: 'two', sender: 'other@example.invalid', subject: 'Second synthetic digest', disposition: 'unknown', reason: 'Response lost' }], deliveries: [{ key: 'delivery', body: 'Individual archive report', state: 'unknown', reason: 'Response lost' }], effects: [{ key: 'delivery', operation: 'mail.telegram', state: 'unknown' }] }
  const workflows = vi.fn().mockResolvedValue({ workflows: [], runs: [], mailReview: review })
  window.pods = { workflows } as unknown as typeof window.pods
  const wrapper = mount(MailWorkflowReview, { props: { batchId } })
  await wrapper.get('button').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('First synthetic digest'); expect(wrapper.text()).toContain('Second synthetic digest'); expect(wrapper.text()).toContain('receipt-one')
  await wrapper.findAll('button').find(button => button.text() === 'Record reconciliation evidence')!.trigger('click')
  expect(wrapper.get('button.primary').attributes('disabled')).toBeDefined()
  await wrapper.get('textarea').setValue('Owner verified Telegram delivery in the destination chat')
  await wrapper.get('input[type=number]').setValue('42'); await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(workflows).toHaveBeenLastCalledWith({ type: 'mailResolve', resolution: { batchId, key: 'delivery', outcome: 'confirmed', messageId: 42, evidence: 'Owner verified Telegram delivery in the destination chat' } })
  wrapper.unmount()
})
