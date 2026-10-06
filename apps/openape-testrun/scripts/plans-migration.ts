import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { createClient } from '@libsql/client'
import { initializeHtmlPolicyJournal } from '../server/utils/html-policy-journal'
import { migrateReports } from '../server/database/migrate'
import { applyPlansRollback, capturePlans, importPlans, plansSnapshotDigest, reconcilePlans, rollbackPlansSnapshot, validatePlansSnapshot } from '../server/utils/plans-migration'

async function main() {
  const { values, positionals } = parseArgs({ options: { database: { type: 'string' }, input: { type: 'string' }, output: { type: 'string' }, 'expected-digest': { type: 'string' }, 'writers-frozen': { type: 'boolean' }, help: { type: 'boolean' } }, allowPositionals: true })
  const command = positionals[0]
  if (values.help) {
    process.stdout.write('Plans migration: snapshot|import|reconcile|rollback-export|rollback-apply --database file:/absolute/path --input snapshot.json --output new-file.json --writers-frozen\nUse a consistent backup, freeze both writers before migration or rollback, and verify reconciliation before routing. rollback-apply also requires --expected-digest from the frozen legacy snapshot. Outputs contain private source and identities; never publish them as test evidence.\n'); return
  }
  if (positionals.length !== 1 || !['snapshot', 'import', 'reconcile', 'rollback-export', 'rollback-apply'].includes(command ?? '') || !values.database?.startsWith('file:/')) throw new Error('Use --help; an explicit local database path is required')
  if (['import', 'rollback-export', 'rollback-apply'].includes(command!) && !values['writers-frozen']) throw new Error('Verify both writers are frozen, then pass --writers-frozen')
  const client = createClient({ url: values.database })
  try {
    const snapshot = values.input ? validatePlansSnapshot(JSON.parse(readFileSync(resolve(values.input), 'utf8'))) : undefined
    let result: unknown
    if (command === 'snapshot' || command === 'rollback-export') {
      if (!values.output) throw new Error('An exclusive --output file is required')
      const data = command === 'snapshot' ? await capturePlans(client) : await rollbackPlansSnapshot(client)
      writeFileSync(resolve(values.output), JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 })
      result = { digest: plansSnapshotDigest(data), plans: data.plans.length, output: resolve(values.output) }
    }
    else {
      if (!snapshot) throw new Error('--input snapshot.json is required')
      if (command === 'import') { await migrateReports(client); await initializeHtmlPolicyJournal(client, `${resolve(values.database.slice(5))}.policies.json`); result = await importPlans(client, snapshot) }
      else if (command === 'reconcile') { result = await reconcilePlans(client, snapshot); if (!(result as { reconciled: boolean }).reconciled) process.exitCode = 1 }
      else { if (!values['expected-digest']) throw new Error('--expected-digest is required'); result = await applyPlansRollback(client, values['expected-digest'], snapshot) }
    }
    process.stdout.write(`${JSON.stringify(result)}\n`)
  }
  finally { client.close() }
}
async function entry() {
  try { await main() }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 }
}
void entry()
