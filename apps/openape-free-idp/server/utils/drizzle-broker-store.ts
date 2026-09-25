import type { BrokerConnection, BrokeredGrant } from '@openape/core'
import { sameBrokeredGrant } from '@openape/grants'
import { and, eq, gt, lt, sql } from 'drizzle-orm'
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

export function createDrizzleBrokerStore(): BrokerStore {
  const db = useDb()
  const configuredLimit = Number(process.env.OPENAPE_RATE_LIMIT_MAX_AGENT)
  const requestLimit = Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 120
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
        const recent = await tx.select({ count: sql<number>`count(*)` }).from(brokerRequests).where(and(eq(brokerRequests.connectionId, row.id), gt(brokerRequests.expiresAt, now))).get()
        if ((recent?.count ?? 0) >= requestLimit) throw createError({ statusCode: 429, statusMessage: 'Broker request rate exceeded' })
        const inserted = await tx.insert(brokerRequests).values({ connectionId: row.id, jti: request.jti, expiresAt: request.exp }).onConflictDoNothing().returning({ jti: brokerRequests.jti })
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
