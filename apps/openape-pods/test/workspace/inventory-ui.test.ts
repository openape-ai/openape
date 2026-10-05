import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import PodInventory from '../../src/renderer/PodInventory.vue'

const pod = { id: '00000000-0000-4000-8000-000000000201', name: 'Task monitor', revision: 1, lifecycle: 'active' as const, activeScript: null }

it('shows what each Pod does next to its name', () => {
  const pods = [{ ...pod, description: 'Reports task board changes by Telegram.' }, { ...pod, id: '00000000-0000-4000-8000-000000000202', name: 'Draft' }]
  const wrapper = mount(PodInventory, { props: { pods, workflows: { workflows: [], runs: [] }, available: true, organization: { revision: 1, groups: [] } } })
  const rows = wrapper.findAll('.inventory-row').map(row => row.text())
  expect(rows[0]).toContain('Reports task board changes by Telegram.')
  expect(rows[1]).toBe('DraftStandalone Podactive›')
  wrapper.unmount()
})
