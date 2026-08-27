import { defineCommand } from 'citty'
import { info, printJson, printLine } from '../output.ts'

const PIPELINES = [
  { phase: 'lead', key: 'kalt', name: 'Kalter Lead' },
  { phase: 'lead', key: 'warm', name: 'Warmer Lead' },
  { phase: 'lead', key: 'kontaktiert', name: 'Kontaktiert' },
  { phase: 'lead', key: 'konvertiert', name: 'Zu Deal konvertiert' },
  { phase: 'lead', key: 'disqualifiziert', name: 'Disqualifiziert' },
  { phase: 'lead', key: 'blacklist', name: 'Blacklist' },
  { phase: 'deal', key: 'inbound', name: 'Inbound' },
  { phase: 'deal', key: 'termin', name: 'Termin vereinbart' },
  { phase: 'deal', key: 'demo', name: 'Demo durchgeführt' },
  { phase: 'deal', key: 'followup', name: 'Follow-up-Phase' },
  { phase: 'deal', key: 'angebot', name: 'Angebotsphase' },
  { phase: 'deal', key: 'gewonnen', name: 'Gewonnen' },
  { phase: 'deal', key: 'spaet', name: 'Abschluss spät oder unwahrscheinlich' },
  { phase: 'deal', key: 'verloren', name: 'Final verloren' },
  { phase: 'kunde', key: 'onboarding', name: 'Onboarding' },
  { phase: 'kunde', key: 'zahlend', name: 'Zahlender Kunde' },
  { phase: 'kunde', key: 'abwehr', name: 'Kündigungsabwehr' },
  { phase: 'kunde', key: 'gekuendigt', name: 'Final gekündigt' },
]

export const stagesCommand = defineCommand({
  meta: { name: 'stages', description: 'List the fixed pipeline stages (lead / deal / kunde).' },
  args: {
    json: { type: 'boolean', description: 'JSON output.' },
  },
  async run({ args }) {
    if (args.json) { printJson(PIPELINES); return }
    if (PIPELINES.length === 0) { info('No stages.'); return }
    for (const s of PIPELINES) printLine(`${s.phase.padEnd(6)} ${s.key.padEnd(18)} ${s.name}`)
  },
})
