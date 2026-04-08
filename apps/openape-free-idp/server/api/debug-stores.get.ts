import { sql } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../database/drizzle'

export default defineEventHandler(async (event) => {
  const results: Record<string, unknown> = {}
  const db = useDb()

  // Direct SQL check
  try {
    const row = await db.all(sql`SELECT COUNT(*) as n FROM credentials WHERE user_email = 'patrick@hofmann.eco'`)
    results.directSQL = `${(row[0] as any).n} credentials in DB`
  }
  catch (e: any) { results.directSQL = `error: ${e.message}` }

  // Store check
  const { userStore, credentialStore, sshKeyStore } = useIdpStores()

  try {
    const user = await userStore.findByEmail('patrick@hofmann.eco')
    results.userStore = user ? `found: ${user.email} (has owner: ${!!user.owner})` : 'not found'
  }
  catch (e: any) { results.userStore = `error: ${e.message}` }

  try {
    const creds = await credentialStore.findByUser('patrick@hofmann.eco')
    results.credentialStore = `${creds.length} credentials via store`
  }
  catch (e: any) { results.credentialStore = `error: ${e.message}` }

  try {
    const keys = await sshKeyStore.findByUser('patrick@hofmann.eco')
    results.sshKeyStore = `${keys.length} keys via store`
  }
  catch (e: any) { results.sshKeyStore = `error: ${e.message}` }

  // Check if store uses Drizzle (indirect: try a query that only works with Drizzle schema)
  try {
    const owned = await userStore.findByOwner('patrick@hofmann.eco')
    results.findByOwner = `${owned.length} owned users`
  }
  catch (e: any) { results.findByOwner = `error: ${e.message}` }

  return results
})
