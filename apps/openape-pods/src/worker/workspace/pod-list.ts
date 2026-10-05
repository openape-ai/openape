import { descriptionSummary } from '../../contracts/description'
import type { PodDatabase } from '../storage/database'

/** Pods as the inventory shows them: each with the one-line summary of its description, when it has one. */
export function listedPods(store: PodDatabase): (ReturnType<PodDatabase['listPods']>[number] & { description?: string })[] {
  const bodies = new Map(store.db.prepare('SELECT pod_id,body FROM pod_descriptions').all().map(row => [row.pod_id as string, row.body as string]))
  return store.listPods().map((pod) => {
    const description = descriptionSummary(bodies.get(pod.id) ?? '')
    return description ? { ...pod, description } : pod
  })
}
