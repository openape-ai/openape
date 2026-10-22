import { eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { vaults } from '../database/schema'
import { createProblemError } from './problem'

export async function requireOwnVault(owner: string) {
  const vault = await useDb().select().from(vaults).where(eq(vaults.ownerEmail, owner)).get()
  if (!vault) throw createProblemError({ status: 404, title: 'You have no vault yet' })
  return vault
}
