import { createClient } from '@libsql/client/http'
import crypto from 'node:crypto'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (!body?.id) {
    throw createError({ statusCode: 400, message: 'Missing id' })
  }

  const rc = useRuntimeConfig()
  const client = createClient({
    url: (rc.tursoUrl as string).trim(),
    authToken: (rc.tursoAuthToken as string)?.trim() || undefined,
  })

  const keys = await client.execute({ sql: 'SELECT key_id FROM ssh_keys WHERE user_email = ?', args: [body.id] })
  if (keys.rows.length === 0) {
    throw createError({ statusCode: 404, message: 'No user with SSH keys found' })
  }

  const challenge = crypto.randomBytes(32).toString('hex')
  await client.execute({
    sql: 'INSERT INTO grant_challenges (challenge, agent_id, expires_at) VALUES (?, ?, ?)',
    args: [challenge, body.id, Date.now() + 60_000],
  })

  return { challenge }
})
