// The registry adapters `pnpm seed:shapes` marks as virtual (desktop-own
// operations of OpenApe Pods), read from desktop-own-shapes.json.

import { readFileSync } from 'node:fs'

const file = new URL('./desktop-own-shapes.json', import.meta.url)

/** The cli ids listed in desktop-own-shapes.json; fails on a malformed file instead of marking nothing. */
export function desktopOwnShapeIds(source = file) {
  const { cli_ids: ids } = JSON.parse(readFileSync(source, 'utf8'))
  if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => typeof id !== 'string' || !id))
    throw new Error(`${source} must list cli_ids as non-empty strings`)
  return new Set(ids)
}

/**
 * Marks exactly the desktop-own shapes `virtual: true`. A listed cli id the
 * registry does not provide fails the seed, so no desktop-own operation can
 * stay unmarked and be read as a program.
 */
export function markDesktopOwnShapes(shapes, ids = desktopOwnShapeIds()) {
  const missing = [...ids].filter(id => !shapes.some(shape => shape.cli_id === id))
  if (missing.length) throw new Error(`Desktop-own shapes missing from the registry: ${missing.join(', ')}`)
  return shapes.map(shape => ids.has(shape.cli_id) ? { ...shape, virtual: true } : shape)
}
