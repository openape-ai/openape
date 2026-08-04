// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WizardStepPolicy from '../app/components/WizardStepPolicy.vue'

const stubs = {
  USelect: { props: ['modelValue'], template: '<select />' },
  UInput: { props: ['modelValue'], template: '<input />' },
}

const initial = { max_risk: 'low' as const, grant_type: 'always' as const, reason: '' }

function mountStep(props: Record<string, unknown> = {}) {
  return mount(WizardStepPolicy, { props: { initial, ...props }, global: { stubs } })
}

// The first four buttons are the risk levels; the grant-type pair follows.
const ALWAYS = 4
const TIMED = 5

describe('wizard step: policy', () => {
  it('reports its starting state right away, so the wizard is never out of sync', () => {
    expect(mountStep().emitted('update')?.[0]).toEqual([initial])
  })

  it('hides the duration field until the grant is time-limited', async () => {
    const step = mountStep()
    expect(step.findAllComponents(stubs.UInput)).toHaveLength(1) // only the reason field
    await step.findAll('button')[TIMED]!.trigger('click')
    expect(step.findAllComponents(stubs.UInput)).toHaveLength(2)
  })

  it('defaults a timed grant to one hour instead of leaving it empty', async () => {
    const step = mountStep()
    await step.findAll('button')[TIMED]!.trigger('click')
    const last = step.emitted('update')!.at(-1)![0] as { grant_type: string, duration?: number }
    expect(last).toMatchObject({ grant_type: 'timed', duration: 3600 })
  })

  it('keeps a duration the user already chose when toggling back and forth', async () => {
    const step = mountStep({ initial: { ...initial, grant_type: 'timed' as const, duration: 900 } })
    await step.findAll('button')[ALWAYS]!.trigger('click')
    await step.findAll('button')[TIMED]!.trigger('click')
    const last = step.emitted('update')!.at(-1)![0] as { duration?: number }
    expect(last.duration).toBe(900)
  })

  it('shows the detected risk as a hint only when one was resolved', () => {
    expect(mountStep().text()).not.toContain('Tipp:')
    expect(mountStep({ resolvedRisk: 'high' }).text()).toContain('erkannte Risk-Stufe des Commands ist "high"')
  })
})
