import type { Employee } from '../../app/components/company/OrgNode.vue'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
// Import order is load-bearing: Vite injects SFC styles in the order the test
// imports them, and both components style `.org-tree` at equal specificity.
// OrgNode before Chart mirrors the build, where the child module is evaluated
// first. Swapped, this very test goes green on a chart that overflows.
import OrgNode from '../../app/components/company/OrgNode.vue'
import Chart from '../../app/components/company/Chart.vue'
import de from '../../i18n/locales/de.json'
import en from '../../i18n/locales/en.json'

const messages = { de, en }
type Locale = keyof typeof messages

// A phone viewport (390px) is set in vitest.browser.config.ts. Nuxt UI is
// stubbed; the styles under test ship with the two components themselves.
//
// Stubs must be render functions, not `template` strings: the browser build of
// Vue ships without the compiler, so a string template renders NOTHING. A chart
// of empty boxes passes every width assertion — the test would measure its own
// blind spot. `renders every stub it declares` guards exactly that.
function globalOptions(locale: Locale) {
  return {
    stubs: {
      UButton: { render: () => h('button', { class: 'stub-button' }, 'x') },
      UIcon: { render: () => h('span', { class: 'stub-icon' }, '·') },
    },
    components: { CompanyOrgNode: OrgNode },
    // Real messages, not a stub translator: the card carries translated text
    // ("Team-Lead" vs "Team lead"), and the German one is the wider of the two.
    plugins: [createI18n({ legacy: false, globalInjection: true, locale, messages })],
  }
}

function employee(id: string, over: Partial<Employee> = {}): Employee {
  return {
    id,
    role: 'specialist',
    label: id,
    duties: '',
    procedure: '',
    vars: {},
    tools: [],
    enabled: true,
    reportsTo: null,
    ...over,
  }
}

// The long tool list is the point: it is what pushed the card past the screen.
const EMPLOYEES: Employee[] = [
  employee('operator', { role: 'ceo', label: 'Operator', tools: ['ape-tasks *'] }),
  employee('lead', { role: 'teamlead', label: 'IURIO Scrum Team Manager', reportsTo: 'operator', tools: ['iurio *', 'ape-tasks *', 'git *'] }),
  employee('mail', {
    label: 'Mail & Kalender-Assistent',
    reportsTo: 'lead',
    tools: ['o365-cli mail list *', 'o365-cli mail read *', 'o365-cli calendar get *', 'pdftotext *', 'jq'],
  }),
]

function mountChart(locale: Locale) {
  return mount(Chart, {
    props: { employees: EMPLOYEES, ownerEmail: 'patrick@hofmann.eco' },
    global: globalOptions(locale),
    attachTo: document.body,
  })
}

describe.each(['en', 'de'] as const)('org chart on a phone (%s)', (locale) => {
  it('renders every stub it declares', () => {
    const wrapper = mountChart(locale)

    // If this drops to 0 the widths below are measuring empty boxes.
    expect(wrapper.findAll('.stub-button').length).toBeGreaterThan(0)
    expect(wrapper.findAll('.stub-icon').length).toBeGreaterThan(0)
    expect((wrapper.find('.org-card').element as HTMLElement).offsetWidth).toBeGreaterThan(0)
    // …and that the cards carry translated text rather than raw message keys.
    expect(wrapper.text()).toContain(messages[locale].common.role.teamlead)

    wrapper.unmount()
  })

  it('keeps every card inside the scroller', () => {
    const wrapper = mountChart(locale)

    const scroller = wrapper.find('.org-scroll').element as HTMLElement
    const tree = wrapper.find('.org-tree').element as HTMLElement
    const cards = wrapper.findAll('.org-card').map(c => c.element as HTMLElement)

    expect(scroller.clientWidth).toBeGreaterThan(0)
    expect(tree.offsetWidth).toBeLessThanOrEqual(scroller.clientWidth)
    for (const card of cards) {
      expect(card.offsetWidth).toBeLessThanOrEqual(scroller.clientWidth)
    }

    wrapper.unmount()
  })
})
