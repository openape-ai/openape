import { loadAdapter } from '@openape/apes'
import type { LoadedAdapter } from '@openape/apes'
import pins from '../../../runtime-sources/registry-adapters.json'

export type PodAdapter = keyof typeof pins.adapters

/**
 * Loads one of Pods' own adapters. They are byte-identical copies of shapes-registry entries (issue 1473), so their
 * grants bind the registry's grant digest; a copy whose bytes or semantics differ from its pinned entry is refused.
 */
export function loadPodAdapter(cliId: PodAdapter, path: string): LoadedAdapter {
  const loaded = loadAdapter(cliId, path)
  const pin = pins.adapters[cliId]
  if (loaded.fileDigest !== pin.digest || loaded.digest !== pin.grant_digest) throw new Error(`${cliId} differs from its shapes-registry entry; reinstall OpenApe Pods`)
  return loaded
}
