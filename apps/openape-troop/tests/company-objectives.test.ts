// @vitest-environment happy-dom
import type { Mock } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Objectives from '../app/components/company/Objectives.vue'
import { apiFetch } from '../app/utils/api'

vi.mock('../app/utils/api', () => ({ apiFetch: vi.fn() }))
const fetched = apiFetch as unknown as Mock

// Nuxt UI components are globally auto-imported in the app; stubbed here so the
// assertions read rendered text.
const global = {
  stubs: {
    UInput: { props: ['modelValue'], template: '<input>' },
    UButton: { template: '<button><slot /></button>' },
    UAlert: { props: ['title'], template: '<div class="alert">{{ title }}</div>' },
  },
}

beforeEach(() => {
  fetched.mockReset()
})

describe('company objectives panel', () => {
  it('shows the objectives it loaded', async () => {
    fetched.mockResolvedValue([{ id: 'a', title: 'Umsatz verdoppeln', status: 'planned', description: '', targetDate: null }])

    const wrapper = mount(Objectives, { props: { orgId: 'org-1' }, global })
    await flushPromises()

    expect(wrapper.text()).toContain('Umsatz verdoppeln')
    expect(wrapper.find('.alert').exists()).toBe(false)
  })

  it('shows a load failure instead of an empty board', async () => {
    fetched.mockRejectedValue({ data: { statusMessage: 'Keine Berechtigung für diese Firma.' } })

    const wrapper = mount(Objectives, { props: { orgId: 'org-1' }, global })
    await flushPromises()

    expect(wrapper.find('.alert').text()).toBe('Keine Berechtigung für diese Firma.')
  })
})
