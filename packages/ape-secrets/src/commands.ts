import { writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { defineCommand } from 'citty'
import { error, printJson, printLine } from '@openape/proof-cli'
import type { Collected } from './deliver.ts'
import { keyFingerprint } from '@openape/secrets-crypto'
import { _request, resolveEndpoint } from './client.ts'
import { filePins, openCollected, prepareFileTarget, runWithSecret } from './deliver.ts'
import { generateKeyPair, loadKey, openBox, saveKey } from './keys.ts'
import type { SealedBox } from './keys.ts'

function printErr(line: string) {
  process.stderr.write(`${line}\n`)
}

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

interface VaultRequestView { id: string, status: string, field_name: string, consumer_id: string, expires_at: number, approval_id?: string, approve_url?: string }
interface ApprovalMeta { id: string, status: string, mode: string, expires_at: number | null, consumer_id: string, consumer_key_fingerprint: string }

export const requestCommand = defineCommand({
  meta: { name: 'request', description: 'Ask for a secret. --secret asks the owner\'s vault (approve with a passkey); --field asks a human to type a value (legacy).' },
  args: {
    consumer: { type: 'string', description: 'Consumer id of the machine the value is for', required: true },
    secret: { type: 'string', description: 'Name of a secret in the owner\'s vault, e.g. TELEGRAM_BOT_TOKEN' },
    field: { type: 'string', description: 'Legacy: what a human should type in, e.g. NUXT_TELEGRAM_BOT_TOKEN' },
    purpose: { type: 'string', description: 'Why — shown to the owner' },
    ttl: { type: 'string', description: 'Seconds the request stays open (default 86400)' },
    json: { type: 'boolean', description: 'JSON output (metadata only)' },
  },
  async run({ args }) {
    if (!args.secret === !args.field) throw new Error('Pass exactly one of --secret (vault) or --field (legacy).')
    if (args.secret) {
      const req = await _request<VaultRequestView>('/api/v2/requests', {
        method: 'POST',
        body: { consumerId: args.consumer, secret: args.secret, purpose: args.purpose ?? '', ...(args.ttl ? { ttlSec: Number(args.ttl) } : {}) },
      })
      if (args.json) return printJson(req)
      printLine(`Waiting for the owner to approve ${req.field_name}:`)
      printLine(req.approve_url ?? '')
      printLine('')
      printLine(`Then:  ape-secrets wait ${req.id}`)
      return
    }
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

const POLL_MS = 5000

export const waitCommand = defineCommand({
  meta: { name: 'wait', description: 'Wait until the owner approves or declines a vault request. Prints the approval id.' },
  args: {
    id: { type: 'positional', description: 'Request id from `request --secret`', required: true },
    timeout: { type: 'string', description: 'Seconds to wait (default 900)' },
    json: { type: 'boolean', description: 'JSON output' },
  },
  async run({ args }) {
    const deadline = Date.now() + Number(args.timeout ?? 900) * 1000
    for (;;) {
      const req = await _request<VaultRequestView>(`/api/v2/requests/${args.id}`)
      if (req.status !== 'pending_approval') {
        if (args.json) return printJson(req)
        if (req.status !== 'approved' || !req.approval_id) throw new Error(`The request is ${req.status.replace('_', ' ')}. Nothing will be delivered.`)
        printLine(`Approved. Deliver it with:  ape-secrets deliver ${req.approval_id} --out PATH   (or --stdin / --env NAME -- COMMAND)`)
        printLine(req.approval_id)
        return
      }
      if (Date.now() >= deadline) throw new Error('Still waiting for the owner. Run `ape-secrets wait` again later.')
      await new Promise(resolve => setTimeout(resolve, POLL_MS))
    }
  },
})

export const deliverCommand = defineCommand({
  meta: { name: 'deliver', description: 'Collect an approved secret and hand it straight to a file, or to a command via stdin or one environment variable. Never prints the value.' },
  args: {
    id: { type: 'positional', description: 'Approval id from `wait`', required: true },
    out: { type: 'string', description: 'Write the value to this file (0600). Refuses symlinks and existing files.' },
    overwrite: { type: 'boolean', description: 'With --out: replace an existing file atomically' },
    stdin: { type: 'boolean', description: 'Pipe the value into the command after --' },
    env: { type: 'string', description: 'Pass the value to the command after -- in this environment variable' },
    json: { type: 'boolean', description: 'JSON output (metadata only)' },
  },
  async run({ args }) {
    const command = (args._ as string[] | undefined ?? []).slice(1)
    const targets = [args.out, args.stdin, args.env].filter(Boolean).length
    if (targets !== 1) throw new Error('Pick exactly one target: --out PATH, --stdin -- COMMAND or --env NAME -- COMMAND.')
    if (args.out && command.length) throw new Error('--out writes a file; it does not run a command.')
    if (!args.out && !command.length) throw new Error('Put the command after --, e.g. -- ./deploy.sh')

    // Everything that can fail on this side is checked before collecting, so a
    // one-time approval is not used up on a delivery that cannot happen.
    const meta = await _request<ApprovalMeta>(`/api/v2/approvals/${args.id}`)
    if (meta.status !== 'active') throw new Error(`This approval is ${meta.status}. Nothing to collect.`)
    const key = loadKey(meta.consumer_id)
    const { kty, crv, x, y } = key.privateJwk
    if (await keyFingerprint({ kty, crv, x, y }) !== meta.consumer_key_fingerprint) {
      throw new Error(`The key for ${meta.consumer_id} on this machine is not the one this approval was sealed for.`)
    }
    const file = args.out ? prepareFileTarget(String(args.out), !!args.overwrite) : null

    const collected = await _request<Collected>(`/api/v2/approvals/${args.id}/collect`, { method: 'POST' })
    const opened = await openCollected(collected, key.privateJwk, filePins)
    if (opened.pin === 'pinned') printErr(`Pinned the vault key ${opened.vaultKeyFingerprint.slice(0, 16)} for vault ${collected.vault_id} (first use). Later packages must carry the same key.`)

    if (file) {
      file.write(opened.value)
      if (args.json) return printJson({ approval_id: collected.approval_id, delivered_to: 'file', path: args.out })
      printLine(`Wrote the secret to ${args.out} (0600).`)
      return
    }
    const code = await runWithSecret(command, opened.value, args.stdin ? { stdin: true } : { env: String(args.env) })
    if (code !== 0) {
      const used = collected.mode === 'once' ? ' The one-time approval is used up; ask for a new one.' : ''
      throw new Error(`The command exited with ${code}.${used}`)
    }
    if (args.json) return printJson({ approval_id: collected.approval_id, delivered_to: args.stdin ? 'stdin' : 'env', exit_code: code })
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
