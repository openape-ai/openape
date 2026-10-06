import { parsePodEnrollment } from '../../utils/pod-enrollment'
import { createHash } from 'node:crypto'
import { defineEventHandler, readBody } from 'h3'
import { tryBearerAuth } from '../../utils/agent-auth'
import { useIdpStores } from '../../utils/stores'
import { usePodIdentityStore } from '../../utils/pod-identity-store'
import { createProblemError } from '../../utils/problem'

export default defineEventHandler(async (event) => {
  const caller = await tryBearerAuth(event)
  if (!caller) throw createProblemError({ status: 401, title: 'Owner sign-in is required' })
  if (caller.act !== 'human' || caller.delegation_grant) throw createProblemError({ status: 403, title: 'Only the signed-in human owner can provision a pod identity' })
  const { userStore } = useIdpStores()
  const owner = await userStore.findByEmail(caller.sub)
  if (!owner?.isActive || owner.type === 'agent' || owner.owner) throw createProblemError({ status: 403, title: 'An active human owner is required' })
  const body = parsePodEnrollment(await readBody<unknown>(event))
  const domain = owner.email.split('@')[1]
  if (!domain) throw createProblemError({ status: 400, title: 'Owner email has no identity domain' })
  const identity = createHash('sha256').update(`${owner.email}\0${body.podId}`).digest('hex').slice(0, 32)
  const email = `pod-${identity}@${domain}`
  const keyId = createHash('sha256').update(Buffer.from(body.publicKey.split(' ')[1]!, 'base64')).digest('hex')
  await usePodIdentityStore(event).provision({ email, owner: owner.email, name: body.name, keyId, publicKey: body.publicKey })
  return { email, owner: owner.email, permissions: 'none', keyId }
})
