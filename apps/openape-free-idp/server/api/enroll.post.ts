import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createError, defineEventHandler, readBody } from 'h3'
import { deriveAgentEmail } from '../utils/agent-email'

const PUBLIC_KEY_MAX_LENGTH = 1000

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

  // Owner attribution priority (high → low):
  //
  //   1. Delegated access token: the bearer JWT's `sub` is already
  //      the human owner (the IdP's /api/oauth/token-exchange minted
  //      it that way). `requireAuth` returns that `sub`. The agent's
  //      identity is in the `act.sub` claim of the token, captured
  //      separately for audit. No further lookup needed — `email`
  //      from requireAuth IS the right owner.
  //
  //   2. Direct agent token (legacy / no delegation yet): the bearer
  //      sub IS the agent's email. We fall back to the user-store
  //      lookup that finds the agent's owner. Soft-deprecated by
  //      path 1 — once every Nest/agent setup has a delegation
  //      grant from its owner, this fallback can be removed (#stage-3
  //      tracks the cleanup). Until then, removing it would break
  //      every Nest that hasn't migrated.
  //
  //   3. Direct human token: sub IS the owner. Same as path 1 from
  //      the perspective of this code.
  let effectiveOwner = email
  const callerRecord = await userStore.findByEmail(email)
  if (callerRecord?.type === 'agent' && callerRecord.owner) {
    effectiveOwner = callerRecord.owner
    // Audit signal during the rollout: agent-side delegation flow
    // (registerAgentAtIdp's tryDelegatedEnrollToken) is supposed to
    // mint a token whose `sub` is already the human owner — so when
    // we DO see an agent's email coming through here, it means the
    // delegation path didn't fire (either the agent has no
    // delegation grant, or the token-exchange failed). Counts as a
    // signal to track until we can confidently remove this fallback.
    console.warn(`[enroll] transitive-ownership fallback fired: caller=${email} → owner=${effectiveOwner} (agent has no delegation; consider running \`apes grants delegate --to ${email} --at enroll-agent --approval always\` from the owner)`)
  }

  const existingOwned = await userStore.findByOwner(effectiveOwner)
  if (existingOwned.length >= maxAgents) {
    throw createError({ statusCode: 409, statusMessage: `Agent limit reached (${maxAgents}). Delete an existing agent first.` })
  }

  // The agent email's domain is the issuing IdP's host (per-request issuer
  // from the Host header when this instance is multi-tenant, else the static
  // configured issuer). See server/utils/agent-email.ts for why this isn't a
  // hardcoded constant.
  const issuer = (event.context.openapeIssuer as string | undefined)
    || (config.openapeIdp as { issuer?: string } | undefined)?.issuer
    || 'https://id.openape.ai'
  const agentEmail = deriveAgentEmail(effectiveOwner, body.name, new URL(issuer).host)

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
