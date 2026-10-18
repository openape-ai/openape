import type { OpenApeOwnerScriptAuthority } from '@openape/core'
import { parseOwnerScriptAuthority } from '../../contracts/runs'
import type { RunEffect } from '../../contracts/runs'
import type { PodDatabase } from '../storage/database'
import { ownerScriptAuthority } from '../runs/owner-script'
import { confirmDomainsStopped } from './domains'

function record(data: unknown): Record<string, unknown> {
  const value: unknown = JSON.parse(String(data))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Owner-script start evidence is invalid')
  return value as Record<string, unknown>
}

function matchesAuthority(value: unknown, expected: OpenApeOwnerScriptAuthority): boolean {
  const authority = parseOwnerScriptAuthority(value)
  return Object.entries(expected).every(([key, entry]) => authority[key as keyof OpenApeOwnerScriptAuthority] === entry)
}

function boundarySnapshot(store: PodDatabase, podId: string, runId: string, key: string) {
  const run = store.db.prepare('SELECT * FROM runs WHERE id=? AND pod_id=?').get(runId, podId)
  if (!run || !['interrupted', 'failed', 'cancelled', 'blocked', 'completedWithGaps'].includes(String(run.state)) || key !== `owner-script:${runId}`) throw new Error('Owner-script boundary is not awaiting owner review')
  const input = store.db.prepare('SELECT * FROM run_inputs WHERE run_id=?').get(runId)
  const events = store.db.prepare('SELECT sequence,type,data FROM run_events WHERE run_id=? AND type IN (\'started\',\'root-script\',\'recovery-boundary\',\'recovery-boundary-result\') ORDER BY sequence').all(runId)
  const starts = events.filter(event => event.type === 'started')
  const boundaries = events.filter(event => event.type === 'recovery-boundary' && record(event.data).id === key)
  const authorizations = events.filter(event => event.type === 'root-script' && record(event.data).state === 'authorized')
  if (!input || starts.length !== 1 || boundaries.length !== 1 || authorizations.length !== 1) throw new Error('Owner-script start evidence is incomplete')
  if (events.some(event => event.type === 'recovery-boundary-result' && record(event.data).id === key) || events.some(event => event.type === 'root-script' && record(event.data).state !== 'authorized')) throw new Error('Owner-script boundary is already settled or conflicting')
  const start = record(starts[0]!.data)
  if (!['manual', 'schedule', 'event'].includes(String(input.reason)) || start.reason !== input.reason || start.scriptHash !== run.script_hash || start.assignmentRevision !== run.assignment_revision || !Number.isSafeInteger(start.resourceEpoch) || Number(start.resourceEpoch) < 0) throw new Error('Owner-script historical run binding does not match')
  const authority = parseOwnerScriptAuthority(ownerScriptAuthority({ podId, scriptHash: String(run.script_hash), assignmentRevision: Number(run.assignment_revision), resourceEpoch: Number(start.resourceEpoch) }))
  const boundary = record(boundaries[0]!.data)
  if (boundary.kind !== 'untracked' || boundary.operation !== 'owner-script' || Number(starts[0]!.sequence) >= Number(boundaries[0]!.sequence) || Number(boundaries[0]!.sequence) >= Number(authorizations[0]!.sequence) || !matchesAuthority(boundary.authority, authority) || !matchesAuthority(record(authorizations[0]!.data).authority, authority)) throw new Error('Owner-script activation does not match its historical start')
  const domains = store.db.prepare('SELECT * FROM execution_domains WHERE run_id=? ORDER BY path').all(runId)
  if (!domains.length) throw new Error('Owner-script recovery requires recorded execution domains')
  const lease = store.db.prepare('SELECT * FROM run_leases WHERE run_id=?').get(runId)
  return { authority, snapshot: JSON.stringify({ run, input, events, domains, lease }) }
}

export async function reconcileOwnerScript(store: PodDatabase, helper: string, podId: string, runId: string, key: string, applied: boolean, evidence: string, programOutcome?: 'partial'): Promise<void> {
  if (typeof evidence !== 'string' || !evidence.trim() || evidence.length > 4000) throw new Error('Record your owner-script effect observation before resolving it')
  if (!(applied === false && programOutcome === undefined) && !(applied === true && programOutcome === 'partial')) throw new Error('Owner-script observation must be not applied or applied with a partial outcome')
  const before = boundarySnapshot(store, podId, runId, key)
  await confirmDomainsStopped(store, runId, helper, true)
  store.transaction(() => {
    const current = boundarySnapshot(store, podId, runId, key)
    if (current.snapshot !== before.snapshot) throw new Error('Owner-script evidence changed during process inspection')
    const sequence = store.db.prepare('SELECT coalesce(max(sequence),0)+1 AS next FROM run_events WHERE run_id=?').get(runId)!.next as number
    const result = { id: key, operation: 'owner-script', state: 'reconciled', reconciled: 'owner', outcome: applied ? 'partial' : 'not-applied', applied, evidence, authority: before.authority }
    store.db.prepare('INSERT INTO run_events VALUES(?,?,?,?,?)').run(runId, sequence, 'recovery-boundary-result', JSON.stringify(result), Date.now())
  })
}

export function openOwnerScriptEffects(store: PodDatabase, podId: string): RunEffect[] {
  const rows = store.db.prepare(`SELECT e.run_id AS runId,e.data FROM run_events e JOIN runs r ON r.id=e.run_id
    WHERE r.pod_id=? AND r.state!='running' AND e.type='recovery-boundary'
      AND json_extract(e.data,'$.kind')='untracked' AND json_extract(e.data,'$.operation')='owner-script'
      AND json_extract(e.data,'$.id')='owner-script:' || e.run_id
      AND NOT EXISTS(SELECT 1 FROM run_events receipt WHERE receipt.run_id=e.run_id AND receipt.type='recovery-boundary-result' AND json_extract(receipt.data,'$.id')=json_extract(e.data,'$.id'))
    ORDER BY r.started_at,e.sequence LIMIT 100`).all(podId)
  return rows.map(row => ({ key: `owner-script:${String(row.runId)}`, runId: String(row.runId), authority: parseOwnerScriptAuthority(record(row.data).authority) }))
}
