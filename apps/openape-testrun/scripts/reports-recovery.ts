import { createClient } from '@libsql/client'
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { checkpointFingerprint, checkIntegrity, fileDigest, retrieveCheckpoint } from '../server/recovery/checkpoint'
import { authorityFingerprint } from '../server/recovery/fingerprint'
import { advanceCheckpoint, bootstrapAuthority, prepareLocalState, readHead, readLocalState, reconcileDatabase } from '../server/recovery/state'
import { readRecoveryConfig, s3RecoveryStore } from '../server/recovery/storage'
import { sameReference } from '../server/recovery/validation'
import { persistAuthoritativePolicyJournal } from '../server/utils/html-policy-journal'

async function existingDatabase(url?: string) {
  if (!url?.startsWith('file:/')) throw new Error('An existing absolute --database file:/path is required')
  const info = await lstat(url.slice(5))
  if (!info.isFile()) throw new Error('The database must be a regular file')
  return createClient({ url })
}

async function main() {
  process.umask(0o077)
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      database: { type: 'string' },
      config: { type: 'string' },
      restic: { type: 'string' },
      snapshot: { type: 'string' },
      'snapshot-path': { type: 'string' },
      output: { type: 'string' },
      'writers-frozen': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  })
  const command = positionals[0]
  if (values.help) {
    process.stdout.write('Reports recovery: prepare|bootstrap|checkpoint|recover|status\nprepare --database file:/path --writers-frozen\nbootstrap --database file:/path --config /private/config.json --restic /absolute/restic-wrapper --snapshot FULL_ID --snapshot-path /backed-up/db --writers-frozen\nrecover --config /private/config.json --restic /absolute/restic-wrapper --output /new/private/directory --writers-frozen\nstatus --database file:/path --config /private/config.json\ncheckpoint accepts the same arguments as bootstrap and advances the verified checkpoint without deleting any records.\nFreeze every writer before prepare/bootstrap/checkpoint/recover. Bootstrap retrieves and compares a complete checkpoint from restic. Recover creates a new private directory; it never overwrites a database. Credentials must already exist independently of the source host. No command prunes backups or switches production routing.\n')
    return
  }
  if (positionals.length !== 1 || !['prepare', 'bootstrap', 'checkpoint', 'recover', 'status'].includes(command ?? '')) throw new Error('Use --help for Reports recovery commands')
  if (command !== 'status' && !values['writers-frozen']) throw new Error('Fence every Reports writer first, then pass --writers-frozen')
  if (command === 'prepare') {
    const client = await existingDatabase(values.database)
    try {
      await checkIntegrity(client)
      const instance = await prepareLocalState(client)
      process.stdout.write(`${JSON.stringify({ prepared: true, instance, next: 'Capture and verify an independent restic checkpoint before bootstrap' })}\n`)
    }
    finally { client.close() }
    return
  }
  if (!values.config) throw new Error('--config /private/config.json is required')
  const config = await readRecoveryConfig(values.config)
  const store = s3RecoveryStore(config)
  const key = Buffer.from(config.encryptionKey, 'base64')
  if (command === 'status') {
    const client = await existingDatabase(values.database)
    try {
      const local = await readLocalState(client)
      const remote = await readHead(store, key)
      const matches = local?.instance === remote.head.instance && local.sequence === remote.head.sequence && sameReference(local.tip, remote.head.tip) && await authorityFingerprint(client) === remote.head.fingerprint
      process.stdout.write(`${JSON.stringify({ local, sequence: remote.head.sequence, matches })}\n`)
      if (!matches) process.exitCode = 1
    }
    finally { client.close() }
    return
  }
  if (!values.restic) throw new Error('--restic /absolute/restic-wrapper is required')
  if (command !== 'recover' && (!values.snapshot || !values['snapshot-path'])) throw new Error('Bootstrap and checkpoint rotation require --snapshot FULL_ID and --snapshot-path /backed-up/db')
  if (command === 'recover' && !values.output) throw new Error('Recover requires a new --output directory')
  const output = values.output ? resolve(values.output) : undefined
  if (output) await mkdir(output, { mode: 0o700 })
  const temporary = await mkdtemp(join(output ? dirname(output) : tmpdir(), '.reports-recovery-'))
  const database = join(temporary, 'testrun.db')
  try {
    const head = command === 'recover' ? await readHead(store, key) : undefined
    const snapshot = head?.head.checkpoint.snapshot ?? values.snapshot!
    const path = head?.head.checkpoint.path ?? values['snapshot-path']!
    await retrieveCheckpoint(values.restic, snapshot, path, database)
    const digest = await fileDigest(database)
    if (head && digest !== head.head.checkpoint.digest) throw new Error('Independent checkpoint digest differs from the recovery authority')
    const checkpoint = createClient({ url: `file:${database}` })
    let result: unknown
    try {
      await checkIntegrity(checkpoint)
      if (command === 'bootstrap' || command === 'checkpoint') {
        const live = await existingDatabase(values.database)
        try {
          if (await checkpointFingerprint(live) !== await checkpointFingerprint(checkpoint)) throw new Error('The independent checkpoint differs from the frozen live database')
          const authority = await (command === 'bootstrap' ? bootstrapAuthority : advanceCheckpoint)(checkpoint, store, key, { snapshot, path, digest })
          if ((await readHead(store, key)).etag !== authority.etag) throw new Error('Bootstrap authority changed during readback')
          result = { operation: command, completed: true, instance: authority.head.instance, checkpoint: authority.head.checkpoint }
        }
        finally { live.close() }
      }
      else {
        const recovered = await reconcileDatabase(checkpoint, store, key)
        await checkIntegrity(checkpoint)
        await persistAuthoritativePolicyJournal(checkpoint, `${database}.policies.json`)
        await checkpoint.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        result = { recovered: true, sequence: recovered.head.sequence, replayed: recovered.replayed, checkpoint: recovered.head.checkpoint, output }
        await writeFile(join(temporary, 'recovery-receipt.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
      }
    }
    finally { checkpoint.close() }
    if (command === 'recover' && output) await rename(temporary, output)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  }
  finally { await rm(temporary, { recursive: true, force: true }) }
}

async function entry() {
  try { await main() }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'Reports recovery failed'}\n`); process.exitCode = 1 }
}
void entry()
