import { defineCommand } from 'citty'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { dispatch, dispatchApproval, normalizeJob, status } from '../../codex/handoff'
import { assertPrivateDirectory, digest } from '../../codex/records'
import { connect } from '../../codex/rpc'
import { recordApproval } from '../../codex/approval'
import { queueCommand } from './queue'

function command(operation: 'dispatch' | 'status' | 'reconcile' | 'approve') {
  return defineCommand({
    meta: { name: operation, description: 'Durable handoff to the existing Codex app-server daemon; never starts a daemon or retries an unknown dispatch' },
    args: {
      job: { type: 'string', required: true, description: 'Absolute immutable job JSON path' },
      receipts: { type: 'string', required: true, description: 'Absolute directory for durable private receipts' },
      socket: { type: 'string', description: 'Existing Codex daemon Unix socket' },
      'expected-digest': { type: 'string', description: 'SHA-256 of the normalized job, required for approve and optional otherwise; mismatch blocks before connecting' },
      result: { type: 'boolean', default: false, description: 'Include one complete final answer on status/reconcile only; this is model output, not verified effects' },
      'approval-root': { type: 'string', description: 'Dispatch requires an unexpired exact-job receipt in this owner-controlled directory' },
      reference: { type: 'string', description: 'Approve only: exact IdP operation reference; this command must itself be authorized' },
      'expires-at': { type: 'string', description: 'Approve only: immutable approval expiry as a UTC ISO timestamp' },
      deadline: { type: 'string', description: 'Dispatch only: immutable UTC deadline for a directly authorized new start' },
    },
    async run({ args }) {
      if (!isAbsolute(args.job) || !isAbsolute(args.receipts)) throw new Error('Job and receipt paths must be absolute')
      await assertPrivateDirectory(args.receipts)
      const job = await normalizeJob(JSON.parse(await readFile(args.job, 'utf8')))
      if (args.deadline && (operation !== 'dispatch' || !args.reference || !/^[\w.:-]+$/.test(args.reference) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(args.deadline) || !Number.isFinite(Date.parse(args.deadline)))) throw new Error('--deadline requires dispatch, an exact reference and a valid UTC timestamp')
      if (args.result && !['status', 'reconcile'].includes(operation)) throw new Error('--result requires status or reconcile')
      if (args['expected-digest'] !== undefined && args['expected-digest'] !== digest(job)) {
        process.stdout.write(`${JSON.stringify({ state: 'blocked', phase: 'digest', reason: 'Job content differs from the expected normalized digest' })}\n`)
        process.exitCode = 2
        return
      }
      if (operation === 'approve') {
        if (!args['expected-digest'] || !args.reference || !args['expires-at'] || args['approval-root']) throw new Error('approve requires --expected-digest, --reference and --expires-at; no --approval-root')
        const receipt = await recordApproval(args.receipts, job, args.reference, args['expires-at'])
        const expired = Date.parse(receipt.expiresAt) <= Date.now()
        process.stdout.write(`${JSON.stringify({ state: expired ? 'expired' : 'recorded', receipt })}\n`)
        if (expired) process.exitCode = 2
        return
      }
      if ((args.reference && !args.deadline) || args['expires-at']) throw new Error('--reference requires approve or a dispatch deadline; --expires-at requires approve')
      if (args['approval-root']) {
        if (operation !== 'dispatch' || !isAbsolute(args['approval-root'])) throw new Error('--approval-root requires dispatch and an absolute path')
        try { await dispatchApproval(args.receipts, job, args['approval-root']) }
        catch (error) {
          process.stdout.write(`${JSON.stringify({ state: 'blocked', phase: 'approval', reason: String(error) })}\n`)
          process.exitCode = 2
          return
        }
      }
      const socket = args.socket ?? join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'app-server-control', 'app-server-control.sock')
      const rpc = await connect(socket)
      try {
        const result = operation === 'dispatch' ? await dispatch(args.receipts, job, rpc, { approvalRoot: args['approval-root'], deadline: args.deadline, reference: args.reference }) : await status(args.receipts, job, rpc, { result: args.result })
        process.stdout.write(`${JSON.stringify(result)}\n`)
        if (['dispatching', 'not-started'].includes(result.state)) process.exitCode = 3
        if (['unknown', 'blocked', 'stale', 'failed', 'interrupted'].includes(result.state)) process.exitCode = 2
      }
      finally { rpc.close() }
    },
  })
}

export const codexCommand = defineCommand({
  meta: { name: 'codex', description: 'Dispatch and inspect immutable jobs on the existing Codex daemon' },
  subCommands: {
    lookup: queueCommand('lookup'),
    advance: queueCommand('advance'),
    dispatch: command('dispatch'),
    status: command('status'),
    reconcile: command('reconcile'),
    approve: command('approve'),
    digest: defineCommand({
      meta: { name: 'digest', description: 'Read and normalize a job without connecting or writing; use this exact digest in approval argv' },
      args: { job: { type: 'string', required: true, description: 'Absolute immutable job JSON path' } },
      async run({ args }) {
        if (!isAbsolute(args.job)) throw new Error('Job path must be absolute')
        const job = await normalizeJob(JSON.parse(await readFile(args.job, 'utf8')))
        process.stdout.write(`${JSON.stringify({ schema: 'openape.codex-identity/1', key: job.key, cwd: job.cwd, digest: digest(job) })}\n`)
      },
    }),
  },
})
