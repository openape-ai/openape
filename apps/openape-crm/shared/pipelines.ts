export const PHASES = ['lead', 'deal', 'kunde'] as const

export type Phase = typeof PHASES[number]

export interface Stufe {
  id: string
  label: string
  endmarker?: Phase
  endstufe?: boolean
}

export const PIPELINES: Record<Phase, { label: string, stufen: readonly Stufe[] }> = {
  lead: {
    label: 'Lead',
    stufen: [
      { id: 'kalt', label: 'Kalter Lead' },
      { id: 'warm', label: 'Warmer Lead' },
      { id: 'kontaktiert', label: 'Kontaktiert' },
      { id: 'konvertiert', label: 'Zu Deal konvertiert', endmarker: 'deal' },
      { id: 'disqualifiziert', label: 'Disqualifiziert', endstufe: true },
      { id: 'blacklist', label: 'Blacklist', endstufe: true },
    ],
  },
  deal: {
    label: 'Deal',
    stufen: [
      { id: 'inbound', label: 'Inbound' },
      { id: 'termin', label: 'Termin vereinbart' },
      { id: 'demo', label: 'Demo durchgeführt' },
      { id: 'followup', label: 'Follow-up-Phase' },
      { id: 'angebot', label: 'Angebotsphase' },
      { id: 'gewonnen', label: 'Gewonnen', endmarker: 'kunde' },
      { id: 'spaet', label: 'Abschluss spät oder unwahrscheinlich' },
      { id: 'verloren', label: 'Final verloren', endstufe: true },
    ],
  },
  kunde: {
    label: 'Kunde',
    stufen: [
      { id: 'onboarding', label: 'Onboarding' },
      { id: 'zahlend', label: 'Zahlender Kunde' },
      { id: 'abwehr', label: 'Kündigungsabwehr' },
      { id: 'gekuendigt', label: 'Final gekündigt', endstufe: true },
    ],
  },
}

export function isPhase(value: unknown): value is Phase {
  return typeof value === 'string' && (PHASES as readonly string[]).includes(value)
}

export function stufe(phase: Phase, id: string): Stufe | undefined {
  return PIPELINES[phase].stufen.find(s => s.id === id)
}

export function setzeStufe(
  vorgang: { phase: Phase, stufe: string },
  stufeId: string,
): { phase: Phase, stufe: string, konvertiert: boolean, logTitle?: string, logText?: string } {
  const next = stufe(vorgang.phase, stufeId)
  if (!next) throw new Error('unknown stufe')
  if (next.endmarker) {
    const zielPhase = next.endmarker
    const landung = PIPELINES[zielPhase].stufen[0]
    if (!landung) throw new Error('unknown stufe')
    return {
      phase: zielPhase,
      stufe: landung.id,
      konvertiert: true,
      logTitle: `Automatisch in Phase „${PIPELINES[zielPhase].label}“ überführt`,
      logText: `Endmarker „${next.label}“ erreicht → Landestufe „${landung.label}“.`,
    }
  }
  return { phase: vorgang.phase, stufe: stufeId, konvertiert: false }
}

export function migrateFromOutcome(outcome: 'open' | 'won' | 'lost'): { phase: 'deal', stufe: string } {
  if (outcome === 'won') return { phase: 'deal', stufe: 'gewonnen' }
  if (outcome === 'lost') return { phase: 'deal', stufe: 'verloren' }
  return { phase: 'deal', stufe: 'inbound' }
}

export function planDealMigration(
  rows: { id: string, outcome: 'open' | 'won' | 'lost' }[],
): { id: string, phase: 'deal', stufe: string }[] {
  return rows.map(row => ({ id: row.id, ...migrateFromOutcome(row.outcome) }))
}

export function groupByStufe<T extends { stufe: string }>(
  items: T[],
  phase: Phase,
): { stufe: Stufe, items: T[] }[] {
  return PIPELINES[phase].stufen
    .map(s => ({ stufe: s, items: items.filter(i => i.stufe === s.id) }))
    .filter(g => g.items.length > 0)
}
