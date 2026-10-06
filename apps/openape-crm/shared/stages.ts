/**
 * Stages live per workspace in `pipeline_stages` and can be renamed. What a
 * deal carries is the stable `key` — it survives every rename. Whether a stage
 * closes is said by `outcome`, not by its name.
 */
export const OUTCOMES = ['open', 'won', 'lost'] as const

export type Outcome = typeof OUTCOMES[number]

export interface PipelineStage {
  key: string
  name: string
  outcome: Outcome
  position: number
}

/** The pipeline every new workspace starts with. */
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
 * A key derived from the name — readable in CLI and URL. On a collision a
 * number is appended; if that comes out empty too (punctuation only), the
 * counted `stufe-n` is used.
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
