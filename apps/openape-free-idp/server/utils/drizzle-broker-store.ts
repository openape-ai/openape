import type { BrokerConnection, BrokeredGrant } from '@openape/core'
import { parseBrokerRequesterName, sameBrokeredGrant, spentByCommandToken } from '@openape/grants'
import { and, eq, gt, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { useDb } from '../database/drizzle'
import { brokerAgents, brokerAudit, brokerConnections, brokerRequests, grants, sshKeys, users } from '../database/schema'
import { brokerAuditRow } from './broker-audit'
import { rowToGrant } from './drizzle-grant-store'

function connectionFromRow(row: typeof brokerConnections.$inferSelect): BrokerConnection {
  return { id: row.id, owner: { issuer: row.ownerIssuer, subject: row.owner }, broker_issuer: row.brokerIssuer, agent_domain: row.agentDomain, status: row.status === 'active' ? 'active' : 'revoked', created_at: row.createdAt }
}

function reject(message: string): never {
  throw createError({ statusCode: 403, statusMessage: message })
}

function checkConnection(row: typeof brokerConnections.$inferSelect | undefined, provenance?: BrokeredGrant): asserts row is typeof brokerConnections.$inferSelect {
  if (!row || row.status !== 'active') reject('Broker connection is missing or revoked')
  if (provenance && (row.id !== provenance.connection_id || row.owner !== provenance.owner || row.brokerIssuer !== provenance.broker_issuer || row.brokerIssuer !== provenance.agent_issuer)) reject('Broker connection does not match the grant')
}

type Transaction = Parameters<Parameters<ReturnType<typeof useDb>['transaction']>[0]>[0]

/** The subject when this connection already holds a brokered grant of it, else null. */
async function knownAgent(tx: Transaction, connectionId: string, subject: string): Promise<string | null> {
  const grant = await tx.select({ id: grants.id }).from(grants).where(and(eq(grants.requester, subject), sql`json_extract(${grants.brokered}, '$.connection_id') = ${connectionId}`)).get()
  return grant ? subject : null
}

export function createDrizzleBrokerStore(): BrokerStore {
  const db = useDb()
  const configuredLimit = Number(process.env.OPENAPE_RATE_LIMIT_MAX_AGENT)
  const requestLimit = Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 120
  // Matches the per-agent authorize budget (nuxt-auth-idp utils/authorize-rate-limit); assertions live at most 60 s.
  const configuredCalls = Number(process.env.OPENAPE_RATE_LIMIT_MAX_AUTHORIZE)
  const callLimit = Number.isInteger(configuredCalls) && configuredCalls > 0 ? configuredCalls : 600
  // Ceiling over all agents of one connection, so a broker cannot multiply its budget with more agents.
  const configuredCeiling = Number(process.env.OPENAPE_RATE_LIMIT_MAX_BROKER_CALLS)
  const callCeiling = Number.isInteger(configuredCeiling) && configuredCeiling > 0 ? configuredCeiling : callLimit * 10
  return {
    async createConnection(connection) {
      return await db.transaction(async (tx) => {
        const existing = await tx.select().from(brokerConnections).where(and(eq(brokerConnections.owner, connection.owner.subject), eq(brokerConnections.brokerIssuer, connection.broker_issuer), eq(brokerConnections.agentDomain, connection.agent_domain), eq(brokerConnections.status, 'active'))).get()
        if (existing) return connectionFromRow(existing)
        await tx.insert(brokerConnections).values({ id: connection.id, owner: connection.owner.subject, ownerIssuer: connection.owner.issuer, brokerIssuer: connection.broker_issuer, agentDomain: connection.agent_domain, status: 'active', createdAt: connection.created_at })
        return connection
      }, { behavior: 'immediate' })
    },
    async listConnections(owner) {
      return (await db.select().from(brokerConnections).where(eq(brokerConnections.owner, owner))).map(connectionFromRow)
    },
    async getConnection(id) {
      const row = await db.select().from(brokerConnections).where(eq(brokerConnections.id, id)).get()
      return row ? connectionFromRow(row) : null
    },
    async revokeConnection(id, owner) {
      const changed = await db.update(brokerConnections).set({ status: 'revoked' }).where(and(eq(brokerConnections.id, id), eq(brokerConnections.owner, owner))).returning({ id: brokerConnections.id })
      if (!changed.length) reject('Broker connection belongs to another owner')
    },
    async acceptRequest(request) {
      return await db.transaction(async (tx) => {
        const row = await tx.select().from(brokerConnections).where(eq(brokerConnections.id, request.connection_id)).get()
        checkConnection(row)
        if (row.owner !== request.owner || row.brokerIssuer !== request.iss || row.ownerIssuer !== request.aud) reject('Broker request owner or issuer does not match')
        if (request.operation !== 'connection' && (request.sub.split('@').length !== 2 || request.sub.split('@')[1] !== row.agentDomain)) reject('Agent is outside the authorized domain')
        const owner = await tx.select().from(users).where(eq(users.email, row.owner)).get()
        if (!owner?.isActive || owner.type === 'agent' || owner.owner) reject('Broker owner is inactive')
        const now = Math.floor(Date.now() / 1000)
        await tx.delete(brokerRequests).where(lt(brokerRequests.expiresAt, now))
        // Program calls and status polls of an agent this connection already holds grants for have a budget per
        // agent, bounded by a ceiling over all its agents; every other operation, including the first calls of an
        // agent unknown here, shares the connection's budget. The agent provider's broker_agents rows are not
        // stored at the decision IdP, so its brokered grants are what identify a known agent.
        const subject = request.operation === 'authorize' || request.operation === 'get' ? await knownAgent(tx, row.id, request.sub) : null
        const outstanding = gt(brokerRequests.expiresAt, now)
        const budgets = subject
          ? [{ where: and(eq(brokerRequests.connectionId, row.id), eq(brokerRequests.subject, subject), outstanding), limit: callLimit }, { where: and(eq(brokerRequests.connectionId, row.id), isNotNull(brokerRequests.subject), outstanding), limit: callCeiling }]
          : [{ where: and(eq(brokerRequests.connectionId, row.id), isNull(brokerRequests.subject), outstanding), limit: requestLimit }]
        for (const budget of budgets) {
          const recent = await tx.select({ count: sql<number>`count(*)`, oldest: sql<number | null>`min(${brokerRequests.expiresAt})` }).from(brokerRequests).where(budget.where).get()
          if ((recent?.count ?? 0) >= budget.limit) throw createError({ statusCode: 429, statusMessage: 'Broker request rate exceeded', data: { retry_after: Math.max(1, (recent?.oldest ?? now + 1) - now) } })
        }
        const inserted = await tx.insert(brokerRequests).values({ connectionId: row.id, jti: request.jti, expiresAt: request.exp, subject }).onConflictDoNothing().returning({ jti: brokerRequests.jti })
        if (!inserted.length) throw createError({ statusCode: 409, statusMessage: 'Broker request was already used', data: { type: 'https://openape.org/errors/broker_request_replayed' } })
        return connectionFromRow(row)
      }, { behavior: 'immediate' })
    },
    async assertConnection(provenance) {
      const row = await db.select().from(brokerConnections).where(eq(brokerConnections.id, provenance.connection_id)).get()
      checkConnection(row, provenance)
      const owner = await db.select().from(users).where(eq(users.email, row.owner)).get()
      if (!owner?.isActive || owner.type === 'agent' || owner.owner) reject('Broker owner is inactive')
    },
    async updateRequesterName(subject, provenance, name) {
      const requesterName = parseBrokerRequesterName(name)
      await db.transaction(async (tx) => {
        const connection = await tx.select().from(brokerConnections).where(eq(brokerConnections.id, provenance.connection_id)).get()
        checkConnection(connection, provenance)
        const owner = await tx.select().from(users).where(eq(users.email, connection.owner)).get()
        if (!owner?.isActive || owner.type === 'agent' || owner.owner) reject('Broker owner is inactive')
        await tx.update(grants).set({ brokered: sql`json_set(${grants.brokered}, '$.requester_name', ${requesterName})` }).where(and(
          eq(grants.requester, subject),
          sql`json_extract(${grants.brokered}, '$.connection_id') = ${provenance.connection_id}`,
          sql`json_extract(${grants.brokered}, '$.owner') = ${provenance.owner}`,
          sql`json_extract(${grants.brokered}, '$.broker_issuer') = ${provenance.broker_issuer}`,
          sql`json_extract(${grants.brokered}, '$.agent_issuer') = ${provenance.agent_issuer}`,
          sql`json_extract(${grants.brokered}, '$.key_id') = ${provenance.key_id}`,
          sql`json_extract(${grants.brokered}, '$.requester_name') IS NOT ${requesterName}`,
        ))
      }, { behavior: 'immediate' })
    },
    async recordToken(grant) {
      await db.transaction(async (tx) => {
        const stored = await tx.select().from(grants).where(eq(grants.id, grant.id)).get()
        if (!stored || stored.status !== 'approved' || !sameBrokeredGrant(rowToGrant(stored).brokered, grant.brokered)) reject('Grant is no longer approved')
        const connection = await tx.select().from(brokerConnections).where(eq(brokerConnections.id, grant.brokered!.connection_id)).get()
        checkConnection(connection, grant.brokered)
        const owner = await tx.select().from(users).where(eq(users.email, connection.owner)).get()
        if (!owner?.isActive || owner.type === 'agent' || owner.owner) reject('Broker owner is inactive')
        if (stored.expiresAt && stored.expiresAt <= Math.floor(Date.now() / 1000)) reject('Grant has expired')
        await tx.insert(brokerAudit).values(brokerAuditRow(grant, 'token_issued'))
      }, { behavior: 'immediate' })
    },
    async consume(id, claims) {
      return await db.transaction(async (tx) => {
        const row = await tx.select().from(grants).where(eq(grants.id, id)).get()
        if (!row) reject('Brokered grant was not found')
        const grant = rowToGrant(row)
        if (!grant.brokered || !sameBrokeredGrant(grant.brokered, claims.brokered) || claims.sub !== grant.request.requester || claims.grant_id !== id || claims.aud !== grant.request.audience || claims.target_host !== grant.request.target_host || claims.decided_by !== grant.brokered.owner) reject('Brokered grant provenance mismatch')
        const connection = await tx.select().from(brokerConnections).where(eq(brokerConnections.id, grant.brokered.connection_id)).get()
        checkConnection(connection, grant.brokered)
        if (claims.iss !== connection.ownerIssuer) reject('Grant decision issuer mismatch')
        const owner = await tx.select().from(users).where(eq(users.email, connection.owner)).get()
        if (!owner?.isActive || owner.type === 'agent' || owner.owner) reject('Broker owner is inactive')
        const now = Math.floor(Date.now() / 1000)
        // POST /api/grants/authorize spends a single-use grant when it issues the command
        // token; its first redemption confirms that, every later one is a replay.
        if (spentByCommandToken(grant, claims)) {
          const redeemed = await tx.update(grants).set({ consumedJti: claims.jti }).where(and(eq(grants.id, id), isNull(grants.consumedJti))).returning({ id: grants.id })
          if (!redeemed.length) return { status: 'used', error: 'already_consumed' }
          await tx.insert(brokerAudit).values(brokerAuditRow(grant, 'consumed'))
          return { status: 'consumed', grant }
        }
        if (grant.status !== 'approved') return { status: grant.status, error: grant.status === 'used' ? 'already_consumed' : grant.status }
        if (grant.expires_at && grant.expires_at <= now) return { status: 'expired', error: 'expired' }
        await tx.insert(brokerAudit).values(brokerAuditRow(grant, 'consumed'))
        if (grant.request.grant_type !== 'once') return { status: 'valid', grant }
        await tx.update(grants).set({ status: 'used', usedAt: now }).where(eq(grants.id, id))
        return { status: 'consumed', grant: { ...grant, status: 'used', used_at: now } }
      }, { behavior: 'immediate' })
    },
    async getAgent(subject) {
      const row = await db.select().from(brokerAgents).where(eq(brokerAgents.subject, subject)).get()
      return row ? { subject: row.subject, key_id: row.keyId, owner: row.owner, decision_issuer: row.decisionIssuer, connection_id: row.connectionId } : null
    },
    async bindAgent(binding, name, publicKey) {
      await db.transaction(async (tx) => {
        const existing = await tx.select().from(brokerAgents).where(eq(brokerAgents.subject, binding.subject)).get()
        const user = await tx.select().from(users).where(eq(users.email, binding.subject)).get()
        const duplicate = await tx.select().from(sshKeys).where(eq(sshKeys.keyId, binding.key_id)).get()
        if (existing) {
          if (!user?.isActive || existing.owner !== binding.owner || existing.decisionIssuer !== binding.decision_issuer || existing.connectionId !== binding.connection_id || existing.keyId !== binding.key_id || duplicate?.userEmail !== binding.subject) reject('Existing agent binding cannot be changed')
          return
        }
        if (user || duplicate) reject('Agent identity or key is already assigned')
        const now = Math.floor(Date.now() / 1000)
        await tx.insert(users).values({ email: binding.subject, name, type: 'agent', owner: null, approver: null, isActive: true, createdAt: now })
        await tx.insert(sshKeys).values({ keyId: binding.key_id, userEmail: binding.subject, publicKey, name, createdAt: now })
        await tx.insert(brokerAgents).values({ subject: binding.subject, keyId: binding.key_id, owner: binding.owner, decisionIssuer: binding.decision_issuer, connectionId: binding.connection_id })
      }, { behavior: 'immediate' })
    },
  }
}
