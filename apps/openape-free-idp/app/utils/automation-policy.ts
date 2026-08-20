/**
 * Pure projection between the stored YOLO policy wire format and the
 * owner-facing "Vollautomatik" model. The wire format keeps the historical
 * mode enum; the UI never shows it.
 */

export type YoloMode = 'deny-list' | 'allow-list'

/** Vollautomatik an = default allow (wire: deny-list). */
export function modeFromFullAuto(fullAuto: boolean): YoloMode {
  return fullAuto ? 'deny-list' : 'allow-list'
}

export function fullAutoFromMode(mode: YoloMode): boolean {
  return mode !== 'allow-list'
}

/**
 * The IdP treats a deny-list policy without any restriction as a no-op and
 * falls back to human approval (fail-closed, #1037). A Vollautomatik switch
 * in that state silently does nothing — the UI must say so.
 */
export function isIneffectiveFullAuto(fullAuto: boolean, blockPatternCount: number, riskThreshold: string | null | undefined): boolean {
  return fullAuto && blockPatternCount === 0 && !riskThreshold
}

/**
 * Provenance line for a policy. Policies are increasingly machine-written
 * (e.g. the hourly troop role sync) — the owner must see who wrote the
 * current state and that manual edits will not survive the next sync run.
 */
export function formatProvenance(enabledBy: string, updatedAt: number): string {
  const when = new Date(updatedAt * 1000).toLocaleString()
  return `Zuletzt gesetzt von ${enabledBy} · ${when}`
}
