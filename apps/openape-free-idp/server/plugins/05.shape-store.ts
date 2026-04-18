import { createDrizzleShapeStore } from '../utils/drizzle-shape-store'

/**
 * Wire the Drizzle-backed ShapeStore into the nuxt-auth-idp module's
 * store registry so `useShapeStore()` (called by the shape API handlers)
 * returns a DB-backed instance in production.
 *
 * Skipped under OPENAPE_E2E=1 so Vitest integration tests can use the
 * in-memory default from the module without needing a real Turso client.
 */
export default defineNitroPlugin(() => {
  if (process.env.OPENAPE_E2E === '1') return
  defineShapeStore(() => createDrizzleShapeStore())
})
