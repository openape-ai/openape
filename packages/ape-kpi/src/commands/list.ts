import { defineCommand } from 'citty'
import { printJson, printLine } from '@openape/proof-cli'
import { _request } from '../client.ts'

interface Kpi {
  id: string
  scope: string
  key: string
  value: number
  unit: string | null
  detail: string | null
  createdAt: number
}

/**
 * List your own KPIs (newest first).
 *   ape-kpi list --latest --json
 *   ape-kpi list --scope delta-mind --since 2026-08-12
 */
export const listCommand = defineCommand({
  meta: { name: 'list', description: 'List your KPIs — --latest for the newest value per (scope, key).' },
  args: {
    latest: { type: 'boolean', description: 'Only the newest row per (scope, key)' },
    scope: { type: 'string', description: 'Filter by scope path prefix' },
    since: { type: 'string', description: 'Only rows newer than an ISO date or unix ms' },
    json: { type: 'boolean', description: 'Machine-readable output' },
  },
  async run({ args }) {
    let since: number | undefined
    if (args.since) {
      since = /^\d+$/.test(args.since) ? Number(args.since) : Date.parse(args.since)
      if (!Number.isFinite(since)) {
        printLine(`--since must be an ISO date or unix ms, got "${args.since}"`)
        process.exitCode = 1
        return
      }
    }

    const res = await _request<{ kpis: Kpi[] }>('/api/kpis', {
      method: 'GET',
      query: {
        ...(args.latest ? { latest: 1 } : {}),
        ...(args.scope ? { scope: args.scope } : {}),
        ...(since ? { since } : {}),
      },
    })

    if (args.json) {
      printJson(res.kpis)
      return
    }
    if (!res.kpis.length) {
      printLine('no KPIs yet — push one: ape-kpi push demo.test 1')
      return
    }
    for (const kpi of res.kpis) {
      const when = new Date(kpi.createdAt).toISOString().slice(0, 16).replace('T', ' ')
      const unit = kpi.unit ? ` ${kpi.unit}` : ''
      const detail = kpi.detail ? '  [detail]' : ''
      printLine(`${when}  ${kpi.scope.padEnd(20)}  ${kpi.key.padEnd(28)}  ${kpi.value}${unit}${detail}`)
    }
  },
})
