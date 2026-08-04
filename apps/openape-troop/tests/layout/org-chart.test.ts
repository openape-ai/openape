import type { Employee } from '../../app/components/company/OrgNode.vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
// Import order is load-bearing: Vite injects SFC styles in the order the test
// imports them, and both components style `.org-tree` at equal specificity.
// OrgNode before Chart mirrors the build, where the child module is evaluated
// first. Swapped, this very test goes green on a chart that overflows.
import OrgNode from '../../app/components/company/OrgNode.vue'
import Chart from '../../app/components/company/Chart.vue'

// A phone viewport (390px) is set in vitest.browser.config.ts. Nuxt UI is
// stubbed; the styles under test ship with the two components themselves.
const global = {
  stubs: { UButton: { template: '<button><slot /></button>' }, UIcon: true },
  components: { CompanyOrgNode: OrgNode },
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

describe('org chart on a phone', () => {
  it('keeps every card inside the scroller', () => {
    const wrapper = mount(Chart, {
      props: { employees: EMPLOYEES, ownerEmail: 'patrick@hofmann.eco' },
      global,
      attachTo: document.body,
    })

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
