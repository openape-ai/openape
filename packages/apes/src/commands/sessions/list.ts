import { defineCommand } from 'citty'
import consola from 'consola'
import { apiFetch } from '../../http'

interface Family {
  familyId: string
  userId: string
  clientId: string
  createdAt: number
  expiresAt: number
  revoked: boolean
}

interface ListResponse {
  data: Family[]
  pagination?: { cursor: string | null, has_more: boolean }
}

export const sessionsListCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List your active refresh-token families (one per logged-in device).',
  },
  args: {
    json: { type: 'boolean', description: 'JSON output' },
    limit: { type: 'string', description: 'Max rows (default 50)' },
  },
  async run({ args }) {
    const path = args.limit ? `/api/me/sessions?limit=${encodeURIComponent(String(args.limit))}` : '/api/me/sessions'
    const result = await apiFetch<ListResponse>(path)

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      return
    }

    if (result.data.length === 0) {
      consola.info('No active sessions.')
      return
    }

    for (const f of result.data) {
      const created = new Date(f.createdAt).toISOString()
      const expires = new Date(f.expiresAt).toISOString()
      console.log(`${f.familyId}  client=${f.clientId}  created=${created}  expires=${expires}`)
    }
  },
})
