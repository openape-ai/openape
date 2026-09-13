import { createHash } from 'node:crypto'
import { defineEventHandler, readBody } from 'h3'
import { tryBearerAuth } from '../../utils/agent-auth'
import { useIdpStores } from '../../utils/stores'
import { usePodIdentityStore } from '../../utils/pod-identity-store'
import { createProblemError } from '../../utils/problem'

function parseEnrollment(value: unknown): { podId: string, name: string, publicKey: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw createProblemError({ status: 400, title: 'Invalid pod identity request' })
  const body = value as Record<string, unknown>
  if (Object.keys(body).some(key => !['podId', 'name', 'publicKey'].includes(key)) || typeof body.podId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.podId) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100 || typeof body.publicKey !== 'string' || body.publicKey.length > 1000) throw createProblemError({ status: 400, title: 'Invalid pod identity fields' })
  const parts = body.publicKey.trim().split(/\s+/)
  const wire = Buffer.from(parts[1] ?? '', 'base64')
  if (parts[0] !== 'ssh-ed25519' || wire.length !== 51 || wire.readUInt32BE(0) !== 11 || wire.subarray(4, 15).toString() !== 'ssh-ed25519' || wire.readUInt32BE(15) !== 32 || wire.toString('base64') !== parts[1]) throw createProblemError({ status: 400, title: 'A valid SSH Ed25519 public key is required' })
  return { podId: body.podId, name: body.name.trim(), publicKey: `${parts[0]} ${parts[1]}` }
}

export default defineEventHandler(async (event) => {
  const caller = await tryBearerAuth(event)
  if (!caller) throw createProblemError({ status: 401, title: 'Owner sign-in is required' })
  if (caller.act !== 'human' || caller.delegation_grant) throw createProblemError({ status: 403, title: 'Only the signed-in human owner can provision a pod identity' })
  const { userStore } = useIdpStores()
  const owner = await userStore.findByEmail(caller.sub)
  if (!owner?.isActive || owner.type === 'agent' || owner.owner) throw createProblemError({ status: 403, title: 'An active human owner is required' })
  const body = parseEnrollment(await readBody<unknown>(event))
  const domain = owner.email.split('@')[1]
  if (!domain) throw createProblemError({ status: 400, title: 'Owner email has no identity domain' })
  const identity = createHash('sha256').update(`${owner.email}\0${body.podId}`).digest('hex').slice(0, 32)
  const email = `pod-${identity}@${domain}`
  const keyId = createHash('sha256').update(Buffer.from(body.publicKey.split(' ')[1]!, 'base64')).digest('hex')
  await usePodIdentityStore(event).provision({ email, owner: owner.email, name: body.name, keyId, publicKey: body.publicKey })
  return { email, owner: owner.email, permissions: 'none', keyId }
})
