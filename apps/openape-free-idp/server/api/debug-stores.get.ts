import { sql } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useEvent } from 'nitropack/runtime'
import { useDb } from '../database/drizzle'

export default defineEventHandler(async (event) => {
  const results: Record<string, unknown> = {}

  // 1. Does useEvent() work?
  try {
    const ev = useEvent()
    results.useEvent = ev ? 'OK' : 'null'
    results.eventContext = Object.keys(ev?.context ?? {})
  }
  catch (e: any) { results.useEvent = `error: ${e.message}` }

  // 2. Direct DB query
  try {
    const db = useDb()
    const row = await db.all(sql`SELECT COUNT(*) as n FROM credentials WHERE user_email = 'patrick@hofmann.eco'`)
    results.directSQL = `${(row[0] as any).n} credentials`
  }
  catch (e: any) { results.directSQL = `error: ${e.message}` }

  // 3. Try manually creating a Drizzle credential store
  try {
    const { createDrizzleCredentialStore } = await import('../utils/drizzle-credential-store')
    const store = createDrizzleCredentialStore()
    const creds = await store.findByUser('patrick@hofmann.eco')
    results.manualDrizzleStore = `${creds.length} credentials`
  }
  catch (e: any) { results.manualDrizzleStore = `error: ${e.message}` }

  // 4. Check useIdpStores result
  try {
    const stores = useIdpStores()
    const creds = await stores.credentialStore.findByUser('patrick@hofmann.eco')
    results.viaUseIdpStores = `${creds.length} credentials`
  }
  catch (e: any) { results.viaUseIdpStores = `error: ${e.message}` }

  return results
})
