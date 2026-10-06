import type { H3Event } from 'h3'
import type { OpenApeGrant } from '@openape/core'
import { getHeader } from 'h3'
import { tryBearerAuth } from './agent-auth'
import { getAppSession } from './session'
import { getIdpIssuer, useIdpStores } from './stores'
import { useBrokerStore } from './broker-store'
import { createProblemError } from './problem'

export async function requireBrokerOwner(event: H3Event, write = false): Promise<string> {
  let subject: string | undefined
  if (getHeader(event, 'authorization')) {
    const token = await tryBearerAuth(event)
    if (!token || token.act !== 'human' || token.delegation_grant) throw createProblemError({ status: 403, title: 'Direct human authentication is required' })
    subject = token.sub
  }
  else {
    if (write && getHeader(event, 'origin') !== getIdpIssuer()) throw createProblemError({ status: 403, title: 'Owner request origin is invalid' })
    const session = await getAppSession(event)
    subject = typeof session.data.userId === 'string' ? session.data.userId : undefined
  }
  if (!subject) throw createProblemError({ status: 401, title: 'Owner sign-in is required' })
  const owner = await useIdpStores().userStore.findByEmail(subject)
  if (!owner?.isActive || owner.type === 'agent' || owner.owner) throw createProblemError({ status: 403, title: 'An active human owner is required' })
  return subject
}

export async function requireBrokerGrantOwner(event: H3Event, grant: OpenApeGrant, active = true): Promise<string> {
  const owner = await requireBrokerOwner(event, event.method !== 'GET')
  if (!grant.brokered || grant.brokered.owner !== owner) throw createProblemError({ status: 403, title: 'This grant belongs to another owner' })
  const store = useBrokerStore(event)
  const connection = await store.getConnection(grant.brokered.connection_id)
  if (!connection || connection.owner.subject !== owner || connection.broker_issuer !== grant.brokered.broker_issuer) throw createProblemError({ status: 403, title: 'Grant owner binding is invalid' })
  if (active) await store.assertConnection(grant.brokered)
  return owner
}
