import { createClient } from '@libsql/client'
import { join, resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getFreePort, makeTempDir, startServer } from 'openape-e2e/lifecycle'
import { migrateReports } from '../server/database/migrate'
import { publishHtml } from '../server/utils/html-store'
import { inspectHtml } from '../shared/html-publication'

const root = resolve(import.meta.dirname, '..')
describe('built server backup recovery readiness', () => {
  for (const state of ['missing', 'invalid']) {
    it(`denies all document delivery and health with a ${state} current policy journal`, async () => {
      const directory = makeTempDir('reports-recovery-readiness-'); const database = join(directory, 'reports.db')
      const client = createClient({ url: `file:${database}` })
      let id: string
      try {
        await migrateReports(client)
        const html = '<!doctype html><html><title>Recovered public report</title><body>Must remain inaccessible before current policy reconciliation</body></html>'
        const publication = inspectHtml(html)
        const receipt = await publishHtml(client, { publication, audience: { mode: 'public' } }, html, { subject: 'owner@example.test', actor: 'owner@example.test' }, 'recovery', 'https://example.test')
        id = String(receipt.document_id)
      }
      finally { client.close() }
      if (state === 'invalid') writeFileSync(`${database}.policies.json`, '{"schema":99}', { mode: 0o600 })
      const port = await getFreePort(); const base = `http://127.0.0.1:${port}`
      const starting = startServer({ cwd: root, port, command: () => [process.execPath, '.output/server/index.mjs'], readyPath: '/api/health', timeoutMs: 4000, env: { HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port), NUXT_TURSO_URL: `file:${database}`, NUXT_OPENAPE_SP_SESSION_SECRET: 'synthetic-readiness-secret-at-least-32-characters' } })
      const stopped = expect(starting).rejects.toThrow(state === 'missing' ? 'Missing Reports policy journal' : 'Invalid Reports policy journal')
      await expect.poll(async () => {
        try { return (await fetch(`${base}/api/health`)).status }
        catch { return 0 }
      }, { timeout: 3000, interval: 50 }).toBe(503)
      for (const path of [`/api/documents/${id}`, `/api/documents/${id}/html`, `/d/${id}`, '/api/plans-compat/teams']) {
        const response = await fetch(`${base}${path}`)
        expect(response.status).toBe(503)
        expect(await response.text()).not.toContain('Must remain inaccessible')
      }
      await stopped
    })
  }
})
