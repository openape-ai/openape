import { defineEventHandler, getRouterParam } from 'h3'
import { messageBodyText, recipientAddresses } from '#shared/graph-live'
import { getMessage } from '../../../utils/graph'
import { requireGraphAccess } from '../../../utils/graph-account'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')!
  const graph = await requireGraphAccess(caller.email)
  const msg = await getMessage(graph.accessToken, id)
  return {
    id: msg.id,
    internet_message_id: msg.internetMessageId || null,
    subject: msg.subject || '(ohne Betreff)',
    from: msg.from?.emailAddress?.address || '',
    from_name: msg.from?.emailAddress?.name || null,
    to: recipientAddresses(msg.toRecipients),
    received_at: msg.receivedDateTime || null,
    body: messageBodyText(msg),
  }
})
