import { readFileSync, writeFileSync } from 'node:fs'
import { getAuthorizedBearer } from '@openape/cli-auth'
import { defineCommand } from 'citty'
import { resolveEndpoint } from '../client.ts'
import { printJson, printLine } from '../output.ts'

export const publishCommand = defineCommand({
  meta: { name: 'publish', description: 'Publish a private client-authored document with an immutable link.' },
  args: {
    file: { type: 'positional', required: true, description: 'UTF-8 JSON document envelope; see docs documents.' },
    key: { type: 'string', required: true, description: 'Stable idempotency key; preserve it and the file for retries.' },
    category: { type: 'string', description: 'Client category, for example Test Runs.' },
    'series-id': { type: 'string', description: 'Optional existing report series ID.' },
    'preview-output': { type: 'string', description: 'Write a sanitized local HTML preview without publishing.' },
    endpoint: { type: 'string', description: 'Override the service endpoint.' },
    json: { type: 'boolean', description: 'Print the complete publication receipt.' },
  },
  async run({ args }) {
    if (!/^[\w:.-]{1,200}$/.test(args.key)) throw new Error('Invalid idempotency key')
    let raw = readFileSync(args.file, 'utf8')
    const envelope: unknown = JSON.parse(raw)
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !('type' in envelope) || envelope.type !== 'document') throw new Error('Expected a document envelope')
    if (args.category || args['series-id']) raw = JSON.stringify({ ...envelope, ...(args.category ? { category: args.category } : {}), ...(args['series-id'] ? { seriesId: args['series-id'] } : {}) })
    const endpoint = resolveEndpoint(args.endpoint)
    const bearer = await getAuthorizedBearer({ endpoint, aud: 'testrun.openape.ai' })
    const response = await fetch(`${endpoint}/api/reports${args['preview-output'] ? '/preview' : ''}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { authorization: bearer, 'content-type': 'application/json', 'idempotency-key': args.key }, body: raw,
    })
    if (!response.ok) throw new Error(`Publication failed (HTTP ${response.status}): ${await response.text()}`)
    if (args['preview-output']) {
      writeFileSync(args['preview-output'], await response.text(), { mode: 0o600 })
      printLine(args['preview-output'])
      return
    }
    const receipt = await response.json() as { url: string }
    if (args.json) printJson(receipt)
    else printLine(receipt.url)
  },
})
