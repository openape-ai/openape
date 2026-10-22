import type { DeliveryContext, Envelope } from './vault-crypto'
import { defineCommand } from 'citty'
import { printJson } from '@openape/proof-cli'
import { _request, resolveEndpoint } from './client'
import { loadKey } from './keys'
import { fingerprint, openDelivery } from './vault-crypto'
import { prepareSink } from './deliver'

interface Status { id: string, status: string, consumerId: string, approvalId?: string, descriptor?: DeliveryContext }
export const vaultCommand = defineCommand({
  meta: { name: 'vault', description: 'PRF vault requests and silent, recipient-encrypted delivery' },
  subCommands: {
    request: defineCommand({
      args: { consumer: { type: 'string', required: true }, alias: { type: 'string', required: true }, purpose: { type: 'string' } },
      async run({ args }) {
        loadKey(String(args.consumer))
        const r = await _request<{ id: string, status: string }>('/api/v2/requests', { method: 'POST', body: { consumerId: args.consumer, alias: args.alias, purpose: args.purpose ?? '' } })
        printJson({ ...r, approval_url: `${await resolveEndpoint()}/vault` })
      },
    }),
    cancel: defineCommand({
      args: { id: { type: 'positional', required: true } },
      async run({ args }) { printJson(await _request(`/api/v2/requests/${encodeURIComponent(String(args.id))}/cancel`, { method: 'POST' })) },
    }),
    status: defineCommand({
      args: { id: { type: 'positional', required: true } },
      async run({ args }) { printJson(await _request<Status>(`/api/v2/requests/${encodeURIComponent(String(args.id))}`)) },
    }),
    deliver: defineCommand({
      meta: { description: 'Deliver directly to a NEW 0600 file or a quiet subprocess. Never prints plaintext. Once means at most one retrieval.' },
      args: {
        id: { type: 'positional', required: true },
        out: { type: 'string', description: 'New output file (refuses existing paths and symlinks)' },
        exec: { type: 'string', description: 'JSON array of executable and arguments; value goes to stdin, output is suppressed' },
        env: { type: 'string', description: 'For --exec only: pass as this environment variable instead of stdin' },
      },
      async run({ args }) {
        if (Boolean(args.out) === Boolean(args.exec) || (args.env && !args.exec)) throw new Error('Choose exactly one of --out or --exec; --env requires --exec')
        let command: string[] = []
        if (args.exec) {
          try { command = JSON.parse(String(args.exec)) }
          catch { throw new Error('--exec must be a JSON array') }
          if (!Array.isArray(command)) throw new Error('--exec must be a JSON array')
        }
        const meta = await _request<Status>(`/api/v2/requests/${encodeURIComponent(String(args.id))}`)
        if (meta.status !== 'ready' || !meta.approvalId || !meta.descriptor) throw new Error(`Request is ${meta.status}`)
        const key = loadKey(meta.consumerId)
        const { d: _private, key_ops: _ops, ...pub } = key.privateJwk
        if (await fingerprint(pub) !== meta.descriptor.fingerprint || meta.descriptor.consumerId !== meta.consumerId || meta.descriptor.approvalId !== meta.approvalId) throw new Error('Recipient or approval mismatch')
        const sink = await prepareSink(args.out ? { file: String(args.out) } : { command, env: args.env ? String(args.env) : undefined })
        try {
          const picked = await _request<{ envelope: Envelope }>(`/api/v2/approvals/${encodeURIComponent(meta.approvalId)}/collect`, { method: 'POST', body: { consumerId: meta.consumerId } })
          await sink.write(await openDelivery(key.privateJwk, picked.envelope, meta.descriptor))
          printJson({ status: 'delivered', requestId: meta.id, approvalId: meta.approvalId, destination: args.out ? 'file' : 'process' })
        }
        finally { await sink.close() }
      },
    }),
  },
})
