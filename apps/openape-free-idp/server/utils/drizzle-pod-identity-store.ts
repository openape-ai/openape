import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { useDb } from '../database/drizzle'
import { grants, sshKeys, users } from '../database/schema'

export function createDrizzlePodIdentityStore(): PodIdentityStore {
  const db = useDb()
  return {
    async provision(input) {
      await db.transaction(async (tx) => {
        const owner = await tx.select().from(users).where(eq(users.email, input.owner)).get()
        if (!owner?.isActive || owner.type === 'agent' || owner.owner) throw createError({ statusCode: 403, statusMessage: 'An active human owner is required' })
        const existing = await tx.select().from(users).where(eq(users.email, input.email)).get()
        const keys = await tx.select().from(sshKeys).where(eq(sshKeys.userEmail, input.email))
        const duplicate = await tx.select().from(sshKeys).where(eq(sshKeys.keyId, input.keyId)).get()
        if (duplicate && duplicate.userEmail !== input.email) throw createError({ statusCode: 409, statusMessage: 'Public key is already assigned' })
        if (existing) {
          if (!existing.isActive || existing.owner !== input.owner || existing.approver !== input.owner || existing.type !== 'agent' || keys.length !== 1 || keys[0]?.keyId !== input.keyId) throw createError({ statusCode: 409, statusMessage: 'Pod identity or key conflicts with the existing account' })
          const approved = await tx.select({ id: grants.id }).from(grants).where(and(eq(grants.requester, input.email), eq(grants.status, 'approved'))).get()
          if (approved) throw createError({ statusCode: 409, statusMessage: 'Review the existing pod connection and grants' })
          return
        }
        const createdAt = Math.floor(Date.now() / 1000)
        await tx.insert(users).values({ email: input.email, name: input.name, owner: input.owner, approver: input.owner, type: 'agent', isActive: true, createdAt })
        await tx.insert(sshKeys).values({ keyId: input.keyId, userEmail: input.email, publicKey: input.publicKey, name: input.name, createdAt })
      }, { behavior: 'immediate' })
    },
  }
}
