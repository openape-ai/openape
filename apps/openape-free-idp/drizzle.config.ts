import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './server/database/schema.ts',
  out: './server/database/migrations',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.TURSO_URL || 'file:./dev.db',
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
})
