/**
 * Die Pipeline steht im Code, nicht in der Datenbank: fünf Stufen decken den
 * Bedarf, eine konfigurierbare Stage-Tabelle kostet UI, API und Migrationen
 * für null aktuellen Nutzen.
 */
export const STAGES = ['lead', 'qualified', 'proposal', 'won', 'lost'] as const

export type Stage = typeof STAGES[number]

export const STAGE_LABELS: Record<Stage, string> = {
  lead: 'Lead',
  qualified: 'Qualifiziert',
  proposal: 'Angebot',
  won: 'Gewonnen',
  lost: 'Verloren',
}

/** Stufen, die einen Deal abschließen — sie setzen `closed_at`. */
export const CLOSED_STAGES: Stage[] = ['won', 'lost']

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value)
}
