// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CommandPalette from '../app/components/CommandPalette.vue'

vi.mock('../app/utils/api', () => ({
  apiFetch: vi.fn(async () => []),
}))
vi.stubGlobal('useToast', () => ({ add: vi.fn() }))

describe('commandPalette', () => {
  beforeEach(() => {
    vi.stubGlobal('useToast', () => ({ add: vi.fn() }))
  })

  it('opens on meta+k and shows the empty hint', async () => {
    const wrapper = mount(CommandPalette, { props: { workspaceId: 'ws1' } })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-palette]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Tippen zum Suchen')
  })
})
