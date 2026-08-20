/**
 * Stufen liegen pro Workspace in `pipeline_stages` und sind umbenennbar. Was
 * ein Deal trägt, ist der stabile `key` — der überlebt jedes Umbenennen.
 * Ob eine Stufe abschließt, sagt `outcome`, nicht ihr Name.
 */
export const OUTCOMES = ['open', 'won', 'lost'] as const

export type Outcome = typeof OUTCOMES[number]

export interface PipelineStage {
  key: string
  name: string
  outcome: Outcome
  position: number
}

/** Die Pipeline, mit der jeder neue Workspace startet. */
export const DEFAULT_STAGES: readonly Omit<PipelineStage, 'position'>[] = [
  { key: 'lead', name: 'Lead', outcome: 'open' },
  { key: 'qualified', name: 'Qualifiziert', outcome: 'open' },
  { key: 'proposal', name: 'Angebot', outcome: 'open' },
  { key: 'won', name: 'Gewonnen', outcome: 'won' },
  { key: 'lost', name: 'Verloren', outcome: 'lost' },
]

export const MAX_STAGE_NAME = 40

export function isOutcome(value: unknown): value is Outcome {
  return typeof value === 'string' && (OUTCOMES as readonly string[]).includes(value)
}

/**
 * Ein Schlüssel aus dem Namen — lesbar in CLI und URL. Kollidiert er, hängt
 * eine Zahl an; bleibt auch das leer (nur Sonderzeichen), zählt `stufe-n`.
 */
export function stageKey(name: string, taken: readonly string[]): string {
  const base = name.toLowerCase()
    .replace(/[äöüß]/g, m => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[m]!)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'stufe'

  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base}-${n}`)) n++
  return `${base}-${n}`
}
