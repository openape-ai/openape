import type { Owner } from '@openape/pods-protocol'
import { networkLimits } from '../../contracts/networks'
import type { NetworkDefinition, NetworkDraft } from '../../contracts/networks'
import { canonicalNetworkJson } from '../../contracts/network-json'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import { validateNetworkCompositionValues } from './network-config'
import { NetworkViews } from './network-views'
import { assertNetworkQuota } from './network-quota'

export function validateNetworkComposition(store: PodDatabase, resources: ResourceRegistry, owner: Owner, draft: NetworkDraft, definition: NetworkDefinition) {
  if (Number(store.db.prepare('SELECT count(*) AS count FROM networks').get()!.count) >= networkLimits.networks) throw new Error('Workspace supports at most 64 persistent networks')
  if (draft.expectedSetup && draft.expectedSetup !== new NetworkViews(store, resources).setup(owner, draft.groupId, draft.members.map(member => member.podId)).fingerprint) throw new Error('Network setup changed; review current values and rights again')
  const sharedValues = validateNetworkCompositionValues(store, definition, draft.sharedValues ?? {})
  const additionalBytes = Buffer.byteLength(canonicalNetworkJson(definition)) + Buffer.byteLength(canonicalNetworkJson(sharedValues)) + 16384 * definition.members.length
  store.assertStorage(additionalBytes)
  assertNetworkQuota(store, additionalBytes)
  return sharedValues
}
