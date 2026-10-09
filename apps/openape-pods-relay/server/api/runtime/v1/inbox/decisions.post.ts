import { ProtocolError } from '@openape/pods-protocol'
import { inboxDecisionLimits, parseInboxDecisions } from '../../../../../../openape-pods/src/contracts/inbox'
import { actor, boundary } from '../../../../utils/service'
import { workspaceBody, workspaceBoundary } from '../../../../utils/workspace'
import { inboxStore } from '../../../../utils/inbox-service'

// A signed-in runtime replaces its own open decision set; the owner always comes from the runtime registration.
export default defineEventHandler(event => boundary(event, () => workspaceBoundary(async () => {
  const runtime = actor(event)
  const body = await workspaceBody(event, inboxDecisionLimits.publicationBytes)
  let decisions
  try { decisions = parseInboxDecisions(body) }
  catch { throw new ProtocolError('invalid_inbox_decisions') }
  return inboxStore().syncDecisions(runtime.owner, runtime.id, decisions)
})))
