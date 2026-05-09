import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createError, defineEventHandler, readBody } from 'h3'

const PUBLIC_KEY_MAX_LENGTH = 1000

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-') || 'agent'
}

// Hash-suffixed agent emails (#294).
//
// The historical derivation collapsed dots in the owner's domain
// (`replace(/\./g, '_')`) and joined with `+`, so two distinct owners
// could collide: `foo@example.com` and `foo@example_com` both produced
// `…+foo+example_com@id.openape.ai`. Same for sanitised names where
// "Owner" and "o-w-n-e-r" both flatten to `owner`. First-write-wins
// 409s the second user, but the agent email then misleadingly suggests
// the wrong owner. Worse, an attacker who pre-enrols a colliding agent
// can later claim the agent's identity belongs to them.
//
// Suffixing a short hash of the canonical owner email makes collisions
// statistically improbable while staying readable. 8 hex chars = 32 bits
// of entropy — at our scale (single-digit-thousands of agents per owner
// at most) the birthday-collision risk is negligible, and across owners
// the hash is fully owner-scoped so cross-owner collisions are
// structurally impossible.
function ownerHash(ownerEmail: string): string {
  return createHash('sha256').update(ownerEmail.trim().toLowerCase()).digest('hex').slice(0, 8)
}

function deriveAgentEmail(ownerEmail: string, agentName: string): string {
  const [local, domain] = ownerEmail.split('@')
  const safeName = sanitizeName(agentName)
  return `${safeName}-${ownerHash(ownerEmail)}+${local}+${domain!.replace(/\./g, '_')}@id.openape.ai`
}

export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const config = useRuntimeConfig()
  const maxAgents = config.public.maxAgentsPerUser

  const body = await readBody<{
    name: string
    publicKey: string
  }>(event)

  if (!body.name || !body.publicKey) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required fields: name, publicKey' })
  }

  if (body.publicKey.length > PUBLIC_KEY_MAX_LENGTH) {
    throw createError({ statusCode: 400, statusMessage: `Public key exceeds ${PUBLIC_KEY_MAX_LENGTH} characters` })
  }

  if (!body.publicKey.startsWith('ssh-ed25519 ')) {
    throw createError({ statusCode: 400, statusMessage: 'Public key must be in ssh-ed25519 format' })
  }

  // Defend against `parts[1]!` throwing on `"ssh-ed25519 "` (no base64
  // section) — explicit shape check before non-null-assertion.
  const parts = body.publicKey.trim().split(/\s+/)
  if (parts.length < 2 || !parts[1]) {
    throw createError({ statusCode: 400, statusMessage: 'Public key missing base64 section' })
  }

  const { userStore, sshKeyStore } = useIdpStores()

  // Transitive ownership: when the caller is itself an agent (e.g. a
  // Nest enrolling a child agent on behalf of its human owner),
  // attribute the new agent to the human at the top of the chain. Else
  // the new agent's email gets the caller's full sub-addressed email
  // recursively encoded into the local-part, exploding the format and
  // breaking parseAgentEmail / troop-side ownerDomain validation.
  let effectiveOwner = email
  const callerRecord = await userStore.findByEmail(email)
  if (callerRecord?.type === 'agent' && callerRecord.owner) {
    effectiveOwner = callerRecord.owner
  }

  const existingOwned = await userStore.findByOwner(effectiveOwner)
  if (existingOwned.length >= maxAgents) {
    throw createError({ statusCode: 409, statusMessage: `Agent limit reached (${maxAgents}). Delete an existing agent first.` })
  }

  const agentEmail = deriveAgentEmail(effectiveOwner, body.name)

  const existingByEmail = await userStore.findByEmail(agentEmail)
  if (existingByEmail) {
    throw createError({ statusCode: 409, statusMessage: 'An agent with this name already exists. Choose a different name.' })
  }

  // Create user. owner = effectiveOwner (= the human at the top of
  // the chain when caller is an agent itself; same as the caller for
  // human callers). approver mirrors owner so the YOLO-policy CRUD
  // and grant-approval flows route to the right human.
  const user = await userStore.create({
    email: agentEmail,
    name: body.name,
    owner: effectiveOwner,
    approver: effectiveOwner,
    type: 'agent',
    isActive: true,
    createdAt: Math.floor(Date.now() / 1000),
  })

  // Create SSH key
  const keyData = parts[1]
  const keyId = createHash('sha256').update(Buffer.from(keyData, 'base64')).digest('hex')
  await sshKeyStore.save({
    keyId,
    userEmail: agentEmail,
    publicKey: body.publicKey.trim(),
    name: body.name,
    createdAt: Math.floor(Date.now() / 1000),
  })

  return {
    email: user.email,
    name: user.name,
    owner: user.owner,
    approver: user.approver,
    status: 'active',
  }
})
