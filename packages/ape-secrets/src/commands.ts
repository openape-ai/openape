import { writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { defineCommand } from 'citty'
import { error, printJson, printLine } from '@openape/proof-cli'
import { _request, resolveEndpoint } from './client.ts'
import { generateKeyPair, loadKey, openBox, saveKey  } from './keys.ts'
import type { SealedBox } from './keys.ts'

interface ConsumerView { id: string, name: string, allowed_requesters: string[] }
interface RequestView { id: string, requester: string, field_name: string, purpose: string, status: string, expires_at: number }

export const keygenCommand = defineCommand({
  meta: { name: 'keygen', description: 'Register THIS machine as a consumer. Generates a key pair locally; only the public half is uploaded.' },
  args: {
    name: { type: 'string', description: 'Human-readable machine name (default: hostname)' },
    'allow': { type: 'string', description: 'Comma-separated identities besides you that may raise requests for this machine' },
    'json': { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const name = (args.name as string) || hostname()
    const { publicJwk, privateJwk } = await generateKeyPair()
    const allowedRequesters = String(args.allow ?? '').split(',').map(s => s.trim()).filter(Boolean)

    const consumer = await _request<ConsumerView>('/api/consumers', {
      method: 'POST',
      body: { name, publicKeyJwk: publicJwk, allowedRequesters },
    })
    const path = saveKey({ consumerId: consumer.id, name, privateJwk })

    if (args.json) return printJson({ ...consumer, private_key_path: path })
    printLine(`Consumer registered: ${consumer.id}  (${name})`)
    printLine(`Private key: ${path}  — never leaves this machine, never uploaded.`)
    printLine('')
    printLine(`Ask for a value with:  ape-secrets request --consumer ${consumer.id} --field NAME`)
  },
})

export const consumersCommand = defineCommand({
  meta: { name: 'consumers', description: 'List the machines you registered' },
  args: { json: { type: 'boolean', description: 'JSON output' } },
  async run({ args }) {
    const rows = await _request<ConsumerView[]>('/api/consumers')
    if (args.json) return printJson(rows)
    if (!rows.length) return printLine('No machines yet. Run `ape-secrets keygen` on the one that needs secrets.')
    for (const c of rows) printLine(`${c.id}  ${c.name}${c.allowed_requesters.length ? `  (also: ${c.allowed_requesters.join(', ')})` : ''}`)
  },
})

export const requestCommand = defineCommand({
  meta: { name: 'request', description: 'Ask a human for one value. Prints the link they open.' },
  args: {
    consumer: { type: 'string', description: 'Consumer id the value is for', required: true },
    field: { type: 'string', description: 'What is needed, e.g. NUXT_TELEGRAM_BOT_TOKEN', required: true },
    purpose: { type: 'string', description: 'Why — shown verbatim on the fill page' },
    ttl: { type: 'string', description: 'Seconds the request stays open (default 86400)' },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const req = await _request<RequestView>('/api/requests', {
      method: 'POST',
      body: {
        consumerId: args.consumer,
        fieldName: args.field,
        purpose: args.purpose ?? '',
        ...(args.ttl ? { ttlSec: Number(args.ttl) } : {}),
      },
    })
    const url = `${await resolveEndpoint()}/fill/${req.id}`
    if (args.json) return printJson({ ...req, fill_url: url })
    printLine(`Waiting for ${req.field_name}:`)
    printLine(url)
  },
})

export const statusCommand = defineCommand({
  meta: { name: 'status', description: 'Where a request stands' },
  args: { id: { type: 'positional', description: 'Request id', required: true }, json: { type: 'boolean' } },
  async run({ args }) {
    const req = await _request<RequestView>(`/api/requests/${args.id}`)
    if (args.json) return printJson(req)
    printLine(`${req.status}  ${req.field_name}  (asked by ${req.requester})`)
  },
})

export const listCommand = defineCommand({
  meta: { name: 'list', description: 'Requests you raised or have to answer' },
  args: { json: { type: 'boolean' } },
  async run({ args }) {
    const rows = await _request<RequestView[]>('/api/requests')
    if (args.json) return printJson(rows)
    if (!rows.length) return printLine('Nothing waiting.')
    for (const r of rows) printLine(`${r.status.padEnd(10)} ${r.field_name.padEnd(28)} ${r.id}`)
  },
})

export const fetchCommand = defineCommand({
  meta: { name: 'fetch', description: 'Collect a filled value ONCE and decrypt it here. The envelope is destroyed on the server.' },
  args: {
    id: { type: 'positional', description: 'Request id', required: true },
    consumer: { type: 'string', description: 'Consumer id whose key opens it (default: the request\'s own)' },
    out: { type: 'string', description: 'Write to this file (0600) instead of stdout' },
    'env-line': { type: 'boolean', description: 'Print as FIELD=value, ready to append to an .env' },
  },
  async run({ args }) {
    const meta = await _request<RequestView & { consumer_id: string }>(`/api/requests/${args.id}`)
    const consumerId = (args.consumer as string) || meta.consumer_id
    // Load the key BEFORE collecting: collecting destroys the envelope, so
    // discovering the key is missing afterwards would lose the secret for good.
    const key = loadKey(consumerId)

    const picked = await _request<{ field_name: string, box: SealedBox }>(`/api/requests/${args.id}/collect`, { method: 'POST' })
    const value = await openBox(key.privateJwk, picked.box)

    if (args.out) {
      writeFileSync(args.out as string, args['env-line'] ? `${picked.field_name}=${value}\n` : value, { mode: 0o600 })
      printLine(`Wrote ${picked.field_name} to ${args.out} (0600).`)
      return
    }
    // stdout, so it can be piped somewhere that never touches a shell history.
    process.stdout.write(args['env-line'] ? `${picked.field_name}=${value}\n` : `${value}\n`)
  },
})

export { error }
