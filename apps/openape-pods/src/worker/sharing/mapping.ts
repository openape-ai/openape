import type { PortableExportChoices } from '../../contracts/sharing'
import { portableKey, portableTagsFeature } from '@openape/pods-protocol'
import type { PortableSource } from './source'
import { mapPortablePod } from './pod'
import type { PortableExportContent } from './export'

export type { PortableExportChoices } from '../../contracts/sharing'

export async function mapPortableSource(root: string, source: PortableSource, choices: PortableExportChoices): Promise<PortableExportContent> {
  if (choices.pods.length !== source.pods.length || new Set(choices.pods.map(item => item.podId)).size !== source.pods.length) throw new Error('Portable Pod choices must match every source member once')
  const keys = new Map(choices.pods.map(item => [item.podId, portableKey(item.key)]))
  const podKey = (id: string): string => {
    const key = keys.get(id)
    if (!key) throw new Error('Portable source refers to an unpackaged Pod')
    return key
  }
  const mapped: Awaited<ReturnType<typeof mapPortablePod>>[] = []
  for (const pod of source.pods) {
    const choice = choices.pods.find(item => item.podId === pod.pod.id)
    if (!choice) throw new Error('Portable Pod choices must match every source member once')
    mapped.push(await mapPortablePod(root, pod, choice))
  }
  const payloads = mapped.flatMap(item => item.payloads)
  const entry = { kind: 'pod' as const, key: podKey(source.selection.id) }
  // Only a package that carries tags requires the tag feature, so packages without tags stay importable by older desktops.
  const tagged = mapped.some(item => item.pod.tags)
  return { description: { format: 'openape-package', version: 1, package: choices.package, requiredFeatures: ['portable_aliases_v1', ...(tagged ? [portableTagsFeature] : [])], entry, pods: mapped.map(item => item.pod), compositions: [], applications: mapped.flatMap(item => item.applications) }, payloads }
}
