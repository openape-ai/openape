import { useDb } from '../database/drizzle'
import { ensureCoderSchema } from '../database/init'

// Create the coder tables on boot. The store unit tests build their own
// in-memory db and call ensureCoderSchema directly, so they never exercise
// this path — the real server would otherwise hit an empty db with no tables.
export default defineNitroPlugin(async () => {
  if (process.env.OPENAPE_E2E === '1')
    return
  await ensureCoderSchema(useDb())
})
