import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '../server/utils/cockpit/system-prompt'

const org = { name: 'Delta Mind', visionMd: '', budgetMonthlyEur: 0 }

describe('buildSystemPrompt — delegation grounding', () => {
  it('lists the team with tools and the delegation rule when a team exists', () => {
    const p = buildSystemPrompt(org, [], 'patrick@x', [
      { role: 'specialist', label: 'Mail-Beauftragter', duties: 'liest die Inbox', tools: ['o365-cli'] },
    ])
    expect(p).toContain('Mail-Beauftragter')
    expect(p).toContain('o365-cli')
    expect(p).toContain('DELEGIERE')
    expect(p).not.toContain('kein handlungsfähiges Team')
  })
  it('stays honest reasoning-only when there is no team', () => {
    const p = buildSystemPrompt(org, [], 'patrick@x', [])
    expect(p).toContain('kein handlungsfähiges Team')
    expect(p).not.toContain('DELEGIERE')
  })
})
