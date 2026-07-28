import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '../server/utils/cockpit/system-prompt'

const org = { id: 'org-uuid-123', name: 'Delta Mind', visionMd: '', budgetMonthlyEur: 0 }

describe('buildSystemPrompt — delegation grounding', () => {
  it('lists the team with tools and the delegation rule when a team exists', () => {
    const p = buildSystemPrompt(org, [], 'patrick@x', [
      { id: 'a1', role: 'specialist', label: 'Mail-Beauftragter', duties: 'liest die Inbox', tools: ['o365-cli'] },
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
  it('exposes the orgId so the Operator can self-schedule with the right id', () => {
    const p = buildSystemPrompt(org, [], 'patrick@x', [])
    expect(p).toContain('org-uuid-123')
  })
})

describe('buildSystemPrompt — memory', () => {
  it('injects inline memory bodies verbatim', () => {
    const p = buildSystemPrompt(org, [], 'patrick@x', [], [
      { id: 'm1', title: 'Geheimcode', body: 'Der Geheimcode ist BANANE42.', mode: 'inline' },
    ])
    expect(p).toContain('--- Memory (Geheimcode) ---')
    expect(p).toContain('BANANE42')
  })
  it('lists reference memory as an index line, not its body', () => {
    const p = buildSystemPrompt(org, [], 'patrick@x', [], [
      { id: 'm2', title: 'Buchhaltung', body: 'ein sehr langes Dokument', mode: 'reference' },
    ])
    expect(p).toContain('Buchhaltung [m2]')
    expect(p).toContain('cockpit-agent.sh memory <id>')
    expect(p).not.toContain('ein sehr langes Dokument')
  })
  it('tags role-scoped memory with its target so the Operator knows when it applies', () => {
    const p = buildSystemPrompt(org, [], 'patrick@x', [], [
      { id: 'm3', title: 'Lohnverrechnung', body: 'x', mode: 'reference', scope: 'role', targetId: 'buchhaltung' },
    ])
    expect(p).toContain('Lohnverrechnung (Rolle: buchhaltung) [m3]')
  })
})

describe('buildSystemPrompt — skills', () => {
  it('lists an Operator-assigned skill with its id, tagged as the Operator’s own', () => {
    const p = buildSystemPrompt(org, [], 'patrick@x', [], [], [
      { id: 's1', name: 'monatsbericht', description: 'erstellt den Monatsbericht', assignedTo: ['ceo'] },
    ])
    expect(p).toContain('monatsbericht: erstellt den Monatsbericht (für: dich) [s1]')
    expect(p).toContain('cockpit-agent.sh skill <id>')
  })
  it('tags an agent-assigned skill with that agent’s label', () => {
    const team = [{ id: 'a1', role: 'specialist', label: 'Buchhalter', duties: '', tools: [] }]
    const p = buildSystemPrompt(org, [], 'patrick@x', team, [], [
      { id: 's2', name: 'ablage', description: 'legt Rechnungen ab', assignedTo: ['a1'] },
    ])
    expect(p).toContain('ablage: legt Rechnungen ab (für: Buchhalter) [s2]')
  })
  it('does not surface a skill assigned to nobody', () => {
    const p = buildSystemPrompt(org, [], 'patrick@x', [], [], [
      { id: 's3', name: 'ungenutzt', description: 'x', assignedTo: [] },
    ])
    expect(p).not.toContain('ungenutzt')
    expect(p).not.toContain('Verfügbare Skills')
  })
})
