import type { CentralSnapshot } from '../../src/contracts/central'
import { encodeParts, manifestDigest, splitSnapshot } from '../../src/contracts/central-parts'

/** The parts and manifest of a complete publication, as a desktop sends them with `parts` and `publish` (format 2). */
export function fullPublication(snapshot: CentralSnapshot) {
  const parts = encodeParts(splitSnapshot(snapshot))
  const changes = Object.fromEntries(Array.from(parts, ([key, part]) => [key, part.hash]))
  return { parts: Object.fromEntries(Array.from(parts.values(), part => [part.hash, JSON.parse(part.text)])), changes, hash: manifestDigest(changes) }
}
