/**
 * The server's view of a sealed envelope: four opaque base64 strings it stores
 * and hands back to exactly one machine. Deliberately separate from the
 * browser's `seal`/`open` — this side has no crypto and should keep none, so
 * there is nowhere for a "just decrypt it quickly" shortcut to grow.
 */
export interface SealedBox {
  epk: string
  salt: string
  iv: string
  ct: string
}

/** All four parts, or it is not an envelope. Half a box must not be stored. */
export function isCompleteBox(v: unknown): v is SealedBox {
  if (!v || typeof v !== 'object') return false
  const b = v as Record<string, unknown>
  return (['epk', 'salt', 'iv', 'ct'] as const).every(k => typeof b[k] === 'string' && (b[k] as string).length > 0)
}
