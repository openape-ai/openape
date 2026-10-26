import { defineCommand } from 'citty'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { dispatch, normalizeJob, status } from '../../codex/handoff'
import { assertPrivateDirectory } from '../../codex/records'
import { connect } from '../../codex/rpc'

function command(operation: 'dispatch' | 'status' | 'reconcile') {
  return defineCommand({
    meta: { name: operation, description: 'Durable handoff to the existing Codex app-server daemon; never starts a daemon or retries an unknown dispatch' },
    args: {
      job: { type: 'string', required: true, description: 'Absolute immutable job JSON path' },
      receipts: { type: 'string', required: true, description: 'Absolute directory for durable private receipts' },
      socket: { type: 'string', description: 'Existing Codex daemon Unix socket' },
    },
    async run({ args }) {
      if (!isAbsolute(args.job) || !isAbsolute(args.receipts)) throw new Error('Job and receipt paths must be absolute')
      await assertPrivateDirectory(args.receipts)
      const job = await normalizeJob(JSON.parse(await readFile(args.job, 'utf8')))
      const socket = args.socket ?? join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'app-server-control', 'app-server-control.sock')
      const rpc = await connect(socket)
      try {
        const result = await (operation === 'dispatch' ? dispatch : status)(args.receipts, job, rpc)
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
  subCommands: { dispatch: command('dispatch'), status: command('status'), reconcile: command('reconcile') },
})
