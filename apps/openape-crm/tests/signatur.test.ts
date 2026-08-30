import { describe, expect, it } from 'vitest'
import { signaturPlan } from '../shared/signatur'

describe('signaturPlan', () => {
  it('activates the contract, opens an automatic thread, and moves a deal to kunde', () => {
    const plan = signaturPlan({ phase: 'deal', stufe: 'angebot' })
    expect(plan.contractStatus).toBe('aktiv')
    expect(plan.threadSource).toBe('automatisch')
    expect(plan.threadStatus).toBe('neu')
    expect(plan.stufe).toEqual({
      phase: 'kunde',
      stufe: 'onboarding',
      konvertiert: true,
      logTitle: 'Automatisch in Phase „Kunde“ überführt',
      logText: 'Endmarker „Gewonnen“ erreicht → Landestufe „Onboarding“.',
    })
  })

  it('does not move a vorgang that is already a kunde', () => {
    const plan = signaturPlan({ phase: 'kunde', stufe: 'onboarding' })
    expect(plan.stufe).toBeNull()
  })
})
