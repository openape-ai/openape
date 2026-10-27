import { defineCommand } from 'citty'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { checkQueuePolicy, queueJob } from '../../codex/queue'
import { dispatch, status } from '../../codex/handoff'
import { connect } from '../../codex/rpc'

export function queueCommand(operation: 'lookup' | 'advance') {
  return defineCommand({
    meta: { name: operation, description: operation === 'lookup' ? 'Read the queued job result; never dispatch' : 'Dispatch the selected job in an explicitly authorized queue; not a business approval gate' },
    args: {
      jobs: { type: 'string', required: true, description: 'Fixed private job directory granted to this command' },
      receipts: { type: 'string', required: true, description: 'Fixed private execution directory granted to this command' },
      query: { type: 'string', required: true, description: 'Fixed query file with one workflow id, job filename and canonical digest' },
      policy: { type: 'string', description: 'Advance only: owner-maintained execution policy outside the queue' },
      'policy-digest': { type: 'string', description: 'Advance only: SHA-256 binding of the authorized policy bytes' },
    },
    async run({ args }) {
      const queued = await queueJob(args.jobs, args.receipts, args.query, operation === 'advance')
      if (operation === 'advance') {
        if (!args.policy || !args['policy-digest']) throw new Error('Advance requires --policy and --policy-digest')
        await checkQueuePolicy(queued.job, queued.id, queued.file, args.policy, args['policy-digest'])
      }
      else if (args.policy || args['policy-digest']) {
        throw new Error('Lookup does not accept an execution policy')
      }
      const rpc = await connect(join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'app-server-control', 'app-server-control.sock'))
      try {
        const started = operation === 'advance' ? await dispatch(queued.root, queued.job, rpc) : undefined
        const result = started && started.state !== 'completed' ? started : await status(queued.root, queued.job, rpc, { result: true })
        process.stdout.write(`${JSON.stringify(result)}\n`)
        if (['unknown', 'blocked', 'stale', 'failed', 'interrupted'].includes(result.state)) process.exitCode = 2
      }
      finally { rpc.close() }
    },
  })
}
