import { randomUUID } from 'node:crypto'
import { digest } from '../../src/worker/storage/database'
import type { PodDatabase } from '../../src/worker/storage/database'
import { PodGroups } from '../../src/worker/workspace/groups'

export function seedNetwork(store: PodDatabase) {
  const owner = { issuer: 'https://identity.example.invalid', subject: 'synthetic-owner' }
  const groups = new PodGroups(store)
  groups.execute({ type: 'organize', action: 'create', name: 'Synthetic company', revision: groups.view().revision })
  const groupId = groups.view().groups.at(-1)!.id
  const pod = store.createPod({ name: 'Synthetic network instance' })
  groups.execute({ type: 'organize', action: 'move', podId: pod.id, groupId, revision: groups.view().revision })
  const definitionId = randomUUID(); const networkId = randomUUID(); const subscriptionId = randomUUID(); const caseId = randomUUID(); const eventId = randomUUID(); const runId = randomUUID(); const deliveryId = randomUUID()
  const hash = store.putBlob('export async function run() {}'); const restoreNonce = randomUUID()
  store.transaction(() => {
    store.db.prepare('INSERT INTO network_owners VALUES(?,?)').run(owner.issuer, owner.subject)
    store.db.prepare('INSERT INTO pod_definitions VALUES(?,?,?,?,?)').run(definitionId, owner.issuer, owner.subject, 'Synthetic definition', Date.now())
    store.db.prepare('INSERT INTO pod_definition_versions VALUES(?,1,?,?,?,?)').run(definitionId, hash, digest('lock'), '{}', Date.now())
    store.db.prepare('INSERT INTO instance_definition_bindings VALUES(?,?,1,1)').run(pod.id, definitionId)
    store.db.prepare('INSERT INTO networks(id,owner_issuer,owner_subject,group_id,name,revision,restore_nonce,created_at) VALUES(?,?,?,?,?,1,?,?)').run(networkId, owner.issuer, owner.subject, groupId, 'Synthetic network', restoreNonce, Date.now())
    store.db.prepare('INSERT INTO network_revisions VALUES(?,1,?,?,?)').run(networkId, '{}', digest('{}'), Date.now())
    store.db.prepare('INSERT INTO network_members VALUES(?,?,1,?,1,?)').run(networkId, pod.id, definitionId, randomUUID())
    store.db.prepare('INSERT INTO network_subscriptions VALUES(?,?,1,?,?,?,0)').run(subscriptionId, networkId, pod.id, 'input', digest('schema'))
    store.db.prepare('INSERT INTO network_checkpoints VALUES(?,?,1,?)').run(networkId, pod.id, '{"cursor":"retained"}')
    store.db.prepare('INSERT INTO network_cases VALUES(?,?,?,1,NULL,NULL,?)').run(caseId, networkId, groupId, Date.now())
    store.db.prepare('INSERT INTO network_case_revisions VALUES(?,1,?,NULL,?,?)').run(caseId, '{}', 'open', Date.now())
    store.db.prepare('INSERT INTO runs VALUES(?,?,?,\'interrupted\',1,2,\'Synthetic stopped run\',NULL,0,1)').run(runId, pod.id, hash)
    store.db.prepare('INSERT INTO network_invocations(run_id,network_id,network_revision,pod_id,boot_nonce,restore_nonce,activation_epoch,claim_token,generation,state,manifest) VALUES(?,?,1,?,?,?,1,?,1,\'interrupted\',\'{}\')').run(runId, networkId, pod.id, 'old-boot', restoreNonce, randomUUID())
    store.db.prepare('INSERT INTO network_events VALUES(?,?,1,?,?,1,?,1,?,?,?,?,?,?,?)').run(eventId, networkId, pod.id, definitionId, caseId, 'input', 'source-item', '{"kind":"source"}', digest('schema'), '{"value":"private-network-business"}', digest('{"value":"private-network-business"}'), Date.now())
    store.db.prepare('INSERT INTO network_event_identities VALUES(?,?,?,?,?,?,?,?,?,NULL)').run(networkId, 'source', digest('identity'), eventId, digest('{"value":"private-network-business"}'), digest('schema'), Date.now(), Date.now() + 90 * 86400000, '[]')
    store.db.prepare('INSERT INTO network_deliveries(id,network_id,event_id,subscription_id,case_id,case_revision,state,ready_at,accepted_at,run_id,reason) VALUES(?,?,?,?,?,1,\'unknown\',1,1,?,?)').run(deliveryId, networkId, eventId, subscriptionId, caseId, runId, 'Synthetic uncertain outcome')
    store.db.prepare('INSERT INTO network_queue_counts VALUES(?,\'unknown\',1)').run(networkId)
    store.db.prepare('INSERT INTO network_effect_attempts VALUES(?,1,?,?,1,?,?,\'intent\',1,?)').run(digest('effect'), runId, caseId, digest('input'), digest('manifest'), networkId)
    store.db.prepare('INSERT INTO network_effect_receipts VALUES(?,1,1,\'intent\',?,1)').run(digest('effect'), '{"synthetic":true}')
  })
  return { owner, pod, groupId, definitionId, networkId, subscriptionId, caseId, eventId, runId, deliveryId, restoreNonce, hash }
}
