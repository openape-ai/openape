import { readFileSync } from 'node:fs'
import { defineCommand } from 'citty'
import { printJson, printLine } from '@openape/proof-cli'
import { _request } from '../client.ts'
import { parsePushArgs } from '../kpi-args.ts'

interface KpiResponse {
  kpi: { id: string, scope: string, key: string, value: number, unit: string | null }
}

/**
 * Push one KPI value. The server derives owner + source from the token —
 * a delegated agent pushes for its user.
 *   ape-kpi push mail.docpit.wichtig 3 --scope delta-mind --unit mails --detail-file top.md
 */
export const pushCommand = defineCommand({
  meta: { name: 'push', description: 'Push a KPI value (optionally with a Markdown detail).' },
  args: {
    key: { type: 'positional', description: 'Metric name, dot-hierarchical (mail.docpit.wichtig)', required: true },
    value: { type: 'positional', description: 'Numeric value', required: true },
    scope: { type: 'string', description: 'Grouping path, e.g. delta-mind or delta-mind/mail (default: general)' },
    unit: { type: 'string', description: 'Display unit, e.g. mails, h' },
    'detail': { type: 'string', description: 'Markdown detail inline' },
    'detail-file': { type: 'string', description: 'Read the Markdown detail from a file' },
    json: { type: 'boolean', description: 'Print the stored row as JSON' },
  },
  async run({ args }) {
    let detail = args.detail
    if (args['detail-file'])
      detail = readFileSync(args['detail-file'], 'utf8')

    const parsed = parsePushArgs({ key: args.key, value: args.value, scope: args.scope, unit: args.unit, detail })
    if (!parsed.ok) {
      printLine(parsed.error)
      process.exitCode = 1
      return
    }

    const res = await _request<KpiResponse>('/api/kpis', { method: 'POST', body: parsed.body })
    if (args.json) {
      printJson(res.kpi)
      return
    }
    const { scope, key, value, unit } = res.kpi
    printLine(`pushed ${scope} ${key} = ${value}${unit ? ` ${unit}` : ''}`)
  },
})
