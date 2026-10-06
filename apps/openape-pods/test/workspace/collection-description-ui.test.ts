import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import CollectionDescription from '../../src/renderer/CollectionDescription.vue'

const id = '00000000-0000-4000-8000-000000000301'
const button = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll('button').find(item => item.text() === text)!

it('shows the description and lets the owner edit it in place until the saved text arrives', async () => {
  const wrapper = mount(CollectionDescription, { props: { description: { id, text: 'Sorts incoming mail.', revision: 1 }, label: 'What this network does' } })
  expect(wrapper.text()).toBe('Sorts incoming mail.Edit description')
  await button(wrapper, 'Edit description').trigger('click')
  expect(wrapper.get('label').text()).toBe('What this network does')
  expect(wrapper.get('textarea').element.value).toBe('Sorts incoming mail.')
  await wrapper.get('textarea').setValue('Sorts incoming mail and asks before archiving.')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('save')).toEqual([['Sorts incoming mail and asks before archiving.']])
  expect(wrapper.find('textarea').exists()).toBe(true)
  await wrapper.setProps({ description: { id, text: 'Sorts incoming mail and asks before archiving.', revision: 2 } })
  expect(wrapper.text()).toBe('Sorts incoming mail and asks before archiving.Edit description')
  wrapper.unmount()
})

it('offers to add a description and discards a cancelled draft', async () => {
  const wrapper = mount(CollectionDescription, { props: { description: undefined, label: 'What this workflow does' } })
  expect(wrapper.text()).toBe('Add description')
  await button(wrapper, 'Add description').trigger('click')
  await wrapper.get('textarea').setValue('Draft that is not kept')
  await button(wrapper, 'Cancel').trigger('click')
  expect(wrapper.emitted('save')).toBeUndefined()
  expect(wrapper.text()).toBe('Add description')
  await button(wrapper, 'Add description').trigger('click')
  expect(wrapper.get('textarea').element.value).toBe('')
  wrapper.unmount()
})

it('only shows the text in a read-only view', () => {
  const described = mount(CollectionDescription, { props: { description: { id, text: 'Sorts incoming mail.', revision: 1 }, label: 'What this network does', readOnly: true } })
  expect(described.text()).toBe('Sorts incoming mail.')
  expect(described.find('button').exists()).toBe(false)
  expect(mount(CollectionDescription, { props: { description: undefined, label: 'What this network does', readOnly: true } }).text()).toBe('')
  described.unmount()
})
