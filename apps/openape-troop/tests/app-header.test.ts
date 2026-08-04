// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppHeader from '../app/components/AppHeader.vue'

// Nuxt UI and the top-level switch are auto-imported in the app; here they are
// stubbed to plain elements so assertions read the text, not the design system.
const global = {
  stubs: {
    UButton: { template: '<button :aria-label="$attrs[\'aria-label\']"><slot /></button>' },
    ViewToggle: { props: ['active'], template: '<nav>Ansicht: {{ active }}</nav>' },
  },
}

function header(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  return mount(AppHeader, { props, slots, global })
}

const logoutButton = (wrapper: ReturnType<typeof header>) => wrapper.find('[aria-label="Abmelden"]')

describe('app header — the mark on the left', () => {
  it('shows the gorilla on a top-level page', () => {
    expect(header({ active: 'inbox' }).text()).toContain('🦍')
  })

  it('replaces the gorilla with a labelled way back on a detail page', () => {
    const wrapper = header({ back: { to: '/nests', label: 'Nests' }, active: 'nests' })
    expect(wrapper.text()).toContain('Nests')
    expect(wrapper.text()).not.toContain('🦍')
  })
})

describe('app header — switch and sub-page name', () => {
  it('marks the active view in the switch', () => {
    expect(header({ active: 'companies' }).text()).toContain('Ansicht: companies')
  })

  it('leaves the switch out where there is no view to switch to', () => {
    expect(header({ back: { to: '/inbox', label: 'Inbox' } }).text()).not.toContain('Ansicht:')
  })

  it('appends the sub-page name behind a separator', () => {
    // The two sit in a flex row with a gap, so the text nodes touch —
    // asserting on '/ Regeln' would test a space that does not exist.
    const text = header({ active: 'inbox', title: 'Regeln' }).text()
    expect(text).toContain('Regeln')
    expect(text).toContain('/')
  })

  it('shows no separator when there is no sub-page name', () => {
    expect(header({ active: 'inbox' }).text()).not.toContain('/')
  })
})

describe('app header — logout', () => {
  it('offers logout by default', () => {
    expect(logoutButton(header({ active: 'inbox' })).exists()).toBe(true)
  })

  it('hides logout where the page has no session to end', () => {
    expect(logoutButton(header({ active: 'nests', showLogout: false })).exists()).toBe(false)
  })

  it('lets the page do the logging out', async () => {
    const wrapper = header({ active: 'inbox' })
    await logoutButton(wrapper).trigger('click')
    expect(wrapper.emitted('logout')).toHaveLength(1)
  })
})

describe('app header — page actions', () => {
  it('places the page own buttons before logout', () => {
    const wrapper = header({ active: 'companies' }, { actions: '<button>Firma</button>' })
    const labels = wrapper.findAll('button').map(b => b.text().trim() || b.attributes('aria-label'))
    expect(labels).toEqual(['Firma', 'Abmelden'])
  })
})
