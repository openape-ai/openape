import { randomUUID } from 'node:crypto'
import { ownerWriter, recordKey } from '../../contracts/domain-data'
import { canonicalJson } from '../../contracts/canonical-json'
import { workLimits } from '../../contracts/work'
import type { WorkDeclaration, WorkState } from '../../contracts/work'
import { digest, parseManifest } from '../storage/database'
import type { PodDatabase, ScriptManifest } from '../storage/database'
import type { DataEntryView, DataResultBinding, DomainData } from './domain'

export interface WorkPrincipal { podId: string, runId: string }
export interface WorkItemView { key: string, operation: string, object: string, state: WorkState, attempt: number, readyAt: number, reason: string | null, inputRevision: number }
export interface ClaimedWork { claimToken: string, key: string, operation: string, object: string, attempt: number, fingerprint: string, input: DataEntryView }
interface OperationRow { operation: string, input: string, output: string, fields: string, filter: string, rule_version: number, generation: number, cursor: number }
interface ItemRow { key: string, operation: string, object: string, input_revision: number, fingerprint: string, rule_version: number, generation: number, state: WorkState, attempt: number, lease: number, claim_token: string | null, run_id: string | null, pod_id: string | null, ready_at: number, reason: string | null }

const open: WorkState[] = ['ready', 'retry_wait', 'waiting']
/** Retry delays after a retryable failure: one minute, then five, thirty, two hours and six hours. */
const backoff = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000]

export class StaleWork extends Error {}

export class WorkLedger {
  constructor(private readonly store: PodDatabase, private readonly data: DomainData) {}

  private manifest(podId: string): ScriptManifest | null {
    const pod = this.store.getPod(podId)
    if (!pod.activeScript) return null
    const row = this.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(podId, pod.activeScript)
    return row ? parseManifest(JSON.parse(String(row.manifest))) : null
  }

  /** The operations the Pod's active script declares. */
  declarations(podId: string): WorkDeclaration[] {
    return this.manifest(podId)?.work ?? []
  }

  private operation(name: string): OperationRow {
    const row = this.store.db.prepare('SELECT * FROM work_operations WHERE operation=?').get(name)
    if (!row) throw new Error(`Work operation ${name} is not registered`)
    return row as unknown as OperationRow
  }

  /**
   * The selected contract of an operation the Pod serves. The first serving script registers it with its newest rule
   * version; later scripts must match it, so replacing a Pod keeps the contract its consumers rely on.
   */
  private serving(podId: string, name: string): { declaration: WorkDeclaration, operation: OperationRow } {
    const declaration = this.declarations(podId).find(item => item.operation === name)
    if (!declaration) throw new Error(`The active script does not serve ${name}`)
    let operation = this.store.db.prepare('SELECT * FROM work_operations WHERE operation=?').get(name) as unknown as OperationRow | undefined
    if (!operation) {
      this.data.namespace(declaration.input); this.data.namespace(declaration.output)
      this.store.db.prepare('INSERT INTO work_operations(operation,input,output,fields,filter,rule_version,updated_at) VALUES(?,?,?,?,?,?,?)').run(name, declaration.input, declaration.output, JSON.stringify(declaration.fields), canonicalJson(declaration.filter), declaration.ruleVersions.at(-1)!, Date.now())
      operation = this.operation(name)
    }
    if (operation.input !== declaration.input || operation.output !== declaration.output || operation.fields !== JSON.stringify(declaration.fields) || operation.filter !== canonicalJson(declaration.filter)) throw new Error(`${name} differs from its selected contract; select the new contract with the domain command selectRule`)
    if (!declaration.ruleVersions.includes(operation.rule_version)) throw new Error(`${name} uses rule version ${operation.rule_version}, which the active script does not implement`)
    const input = this.data.namespace(operation.input); const output = this.data.namespace(operation.output)
    if (input.writer !== podId && !input.readers.includes(podId)) throw new Error(`This Pod may not read ${operation.input}`)
    if (output.writer !== podId) throw new Error(`This Pod is not the writer of ${operation.output}`)
    return { declaration, operation }
  }

  /** The fingerprint covers only the declared fields, so unrelated changes (categories, read state) keep results valid. */
  fingerprint(operation: { fields: string }, value: unknown): string {
    const fields = JSON.parse(operation.fields) as string[]
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { value }
    const selected = fields.length ? Object.fromEntries(fields.map(field => [field, Object.hasOwn(source, field) ? source[field] : null])) : value
    return digest(canonicalJson(selected))
  }

  private matches(operation: OperationRow, value: unknown): boolean {
    const filter = JSON.parse(operation.filter) as Record<string, unknown>
    if (!Object.keys(filter).length) return true
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    return Object.entries(filter).every(([field, expected]) => (value as Record<string, unknown>)[field] === expected)
  }

  private workKey(operation: OperationRow, object: string, fingerprint: string): string {
    return digest(canonicalJson([operation.operation, object, fingerprint, operation.rule_version, operation.generation]))
  }

  /** A result whose own input changed afterwards is not current; work derived from it waits for the new result. */
  current(entry: { result?: DataResultBinding } | null): boolean {
    if (!entry?.result) return true
    const source = this.store.db.prepare('SELECT * FROM work_operations WHERE operation=?').get(entry.result.operation) as unknown as OperationRow | undefined
    const row = source ? this.store.db.prepare('SELECT value,deleted FROM data_entries WHERE namespace=? AND key=?').get(source.input, entry.result.input.key.split('/').pop()!) : undefined
    if (!source || !row || row.deleted) return false
    return this.fingerprint(source, JSON.parse(String(row.value))) === entry.result.input.fingerprint && source.rule_version === entry.result.ruleVersion
  }

  /** Records every input entry changed since the cursor as work once; a reset cursor finds the same keys again. */
  private discover(operation: OperationRow): void {
    const rows = this.store.db.prepare('SELECT * FROM data_entries WHERE namespace=? AND sequence>? ORDER BY sequence LIMIT ?').all(operation.input, operation.cursor, workLimits.scan)
    const now = Date.now()
    for (const row of rows) {
      const object = String(row.key)
      const value = row.deleted ? null : JSON.parse(String(row.value)) as unknown
      const result = row.result ? JSON.parse(String(row.result)) as DataResultBinding : undefined
      const eligible = value !== null && this.matches(operation, value) && this.current({ result })
      const key = eligible ? this.workKey(operation, object, this.fingerprint(operation, value)) : null
      this.store.db.prepare(`UPDATE work_items SET state='superseded',reason='The input changed before this work started',updated_at=? WHERE operation=? AND object=? AND key IS NOT ? AND state IN ('ready','retry_wait','waiting')`).run(now, operation.operation, object, key)
      // An input that returns to an earlier fingerprint makes that never-finished, superseded work ready again.
      if (key) {
        this.store.db.prepare(`INSERT INTO work_items(key,operation,object,input_revision,fingerprint,rule_version,generation,state,ready_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'ready',?,?,?)
        ON CONFLICT(key) DO UPDATE SET state='ready',input_revision=excluded.input_revision,reason=NULL,ready_at=excluded.ready_at,updated_at=excluded.updated_at WHERE work_items.state='superseded'`).run(key, operation.operation, object, Number(row.revision), this.fingerprint(operation, value), operation.rule_version, operation.generation, now, now, now)
      }
    }
    if (rows.length) this.store.db.prepare('UPDATE work_operations SET cursor=? WHERE operation=?').run(Number(rows.at(-1)!.sequence), operation.operation)
  }

  private assertRun(principal: WorkPrincipal): void {
    if (!this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=? AND run_id=? AND boot_id NOT LIKE \'fenced:%\'').get(principal.podId, principal.runId)) throw new Error('Work requires the Pod\'s active run')
  }

  private view(row: ItemRow): WorkItemView {
    return { key: row.key, operation: row.operation, object: row.object, state: row.state, attempt: row.attempt, readyAt: row.ready_at, reason: row.reason, inputRevision: row.input_revision }
  }

  /** Ready work of one operation, oldest first; finding is free of model calls and claims nothing. */
  find(principal: WorkPrincipal, input: { operation: string, limit?: number }): WorkItemView[] {
    const limit = input.limit ?? 10
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > workLimits.find) throw new Error(`Find returns 1 to ${workLimits.find} work items`)
    return this.store.transaction(() => {
      this.assertRun(principal)
      this.settleOrphans()
      const { operation } = this.serving(principal.podId, input.operation)
      this.discover(operation)
      return this.store.db.prepare(`SELECT * FROM work_items WHERE operation=? AND (state='ready' OR (state IN ('retry_wait','waiting') AND ready_at<=?)) ORDER BY created_at,key LIMIT ?`)
        .all(operation.operation, Date.now(), limit)
        .map(row => this.view(row as unknown as ItemRow))
    })
  }

  /** Atomically takes one item; a second claimant gets an error, and a changed input supersedes the item. */
  claim(principal: WorkPrincipal, input: { key: string, expectedInputFingerprint?: string }): ClaimedWork {
    return this.store.transaction(() => {
      this.assertRun(principal)
      const row = this.store.db.prepare('SELECT * FROM work_items WHERE key=?').get(String(input.key)) as unknown as ItemRow | undefined
      if (!row) throw new Error('Unknown work item')
      const { operation } = this.serving(principal.podId, row.operation)
      if (!(row.state === 'ready' || ((row.state === 'retry_wait' || row.state === 'waiting') && row.ready_at <= Date.now()))) throw new Error(`Work item is ${row.state}`)
      if (input.expectedInputFingerprint !== undefined && input.expectedInputFingerprint !== row.fingerprint) throw new StaleWork('Work input differs from the expected fingerprint')
      const entry = this.data.get(principal, `${operation.input}/${row.object}`)
      if (!entry || this.fingerprint(operation, entry.value) !== row.fingerprint || operation.rule_version !== row.rule_version || operation.generation !== row.generation) {
        this.store.db.prepare(`UPDATE work_items SET state='superseded',reason='The input changed before this work started',updated_at=? WHERE key=?`).run(Date.now(), row.key)
        throw new StaleWork('Work input changed; find work again')
      }
      if (Number(this.store.db.prepare('SELECT count(*) AS count FROM work_items WHERE run_id=? AND state=\'claimed\'').get(principal.runId)!.count) >= workLimits.claimsPerRun) throw new Error(`A run holds at most ${workLimits.claimsPerRun} claims`)
      const token = randomUUID()
      this.store.db.prepare(`UPDATE work_items SET state='claimed',lease=lease+1,attempt=attempt+1,claim_token=?,run_id=?,pod_id=?,reason=NULL,updated_at=? WHERE key=? AND lease=?`).run(token, principal.runId, principal.podId, Date.now(), row.key, row.lease)
      return { claimToken: token, key: row.key, operation: row.operation, object: row.object, attempt: row.attempt + 1, fingerprint: row.fingerprint, input: entry }
    })
  }

  private claimed(principal: WorkPrincipal, token: unknown): ItemRow {
    this.assertRun(principal)
    const row = this.store.db.prepare('SELECT * FROM work_items WHERE claim_token=?').get(String(token)) as unknown as ItemRow | undefined
    if (!row || row.state !== 'claimed' || row.run_id !== principal.runId || row.pod_id !== principal.podId) throw new Error('This claim is no longer held by this run')
    return row
  }

  /** Writes the result and the completion marker in one transaction; a stale input or claim writes nothing. */
  complete(principal: WorkPrincipal, input: { claimToken: string, result: unknown }): { revision: number } {
    return this.store.transaction(() => {
      const row = this.claimed(principal, input.claimToken)
      const { operation } = this.serving(principal.podId, row.operation)
      const entry = this.data.get(principal, `${operation.input}/${row.object}`)
      // A changed input, rule version or reprocess generation makes the running result stale.
      if (!entry || this.fingerprint(operation, entry.value) !== row.fingerprint || operation.rule_version !== row.rule_version || operation.generation !== row.generation) {
        this.store.db.prepare(`UPDATE work_items SET state='superseded',claim_token=NULL,reason='The input or rule changed while the work ran; the stale result was discarded',updated_at=? WHERE key=?`).run(Date.now(), row.key)
        throw new StaleWork('Work input changed while it ran; the result was not stored')
      }
      const written = this.data.writeResult(principal, operation.output, recordKey(row.object), input.result, { operation: operation.operation, ruleVersion: row.rule_version, input: { key: entry.key, revision: entry.revision, fingerprint: row.fingerprint }, workKey: row.key })
      this.store.db.prepare(`UPDATE work_items SET state='completed',claim_token=NULL,reason=NULL,updated_at=? WHERE key=? AND lease=?`).run(Date.now(), row.key, row.lease)
      return written
    })
  }

  /** A missing prerequisite: the item waits without model calls until `until`, with a visible reason. */
  defer(principal: WorkPrincipal, input: { claimToken: string, reason: string, until?: number }): void {
    const reason = String(input.reason ?? '').slice(0, 2000)
    if (!reason.trim()) throw new Error('Deferred work needs a visible reason')
    const now = Date.now()
    const until = Math.min(now + workLimits.deferMaxMs, Math.max(now + workLimits.deferMinMs, Number.isFinite(input.until) ? Number(input.until) : now + 15 * 60_000))
    this.store.transaction(() => {
      const row = this.claimed(principal, input.claimToken)
      // Waiting is not a failed attempt.
      this.store.db.prepare(`UPDATE work_items SET state='waiting',attempt=attempt-1,claim_token=NULL,ready_at=?,reason=?,updated_at=? WHERE key=? AND lease=?`).run(until, reason, now, row.key, row.lease)
    })
  }

  /** A retryable failure waits with backoff and blocks after five attempts; any other failure blocks visibly. */
  fail(principal: WorkPrincipal, input: { claimToken: string, reason: string, retryable?: boolean }): WorkState {
    return this.store.transaction(() => {
      const row = this.claimed(principal, input.claimToken)
      const state: WorkState = input.retryable && row.attempt < workLimits.attempts ? 'retry_wait' : 'blocked'
      this.store.db.prepare(`UPDATE work_items SET state=?,claim_token=NULL,ready_at=?,reason=?,updated_at=? WHERE key=? AND lease=?`).run(state, Date.now() + backoff[Math.min(row.attempt - 1, backoff.length - 1)]!, String(input.reason ?? 'Work failed').slice(0, 2000), Date.now(), row.key, row.lease)
      return state
    })
  }

  /**
   * Settles the claims a finished or interrupted run still holds: an unresolved external effect of the run holds them
   * as unknown, an application write the run completed holds them for the owner (a new run would write again under a
   * new identity), otherwise they retry with backoff. No path replays anything by itself.
   */
  settleRun(runId: string): void {
    const unknown = !!this.store.db.prepare(`SELECT 1 FROM effect_ledger WHERE run_id=? AND state IN ('intent','unknown') UNION ALL SELECT 1 FROM effect_attempts WHERE run_id=? AND state IN ('intent','unknown') LIMIT 1`).get(runId, runId)
    const wrote = !!this.store.db.prepare(`SELECT 1 FROM effect_ledger WHERE run_id=? AND operation='program.call' AND state='completed' LIMIT 1`).get(runId)
    const now = Date.now()
    for (const row of this.store.db.prepare('SELECT * FROM work_items WHERE run_id=? AND state=\'claimed\'').all(runId) as unknown as ItemRow[]) {
      if (unknown) this.store.db.prepare(`UPDATE work_items SET state='unknown',claim_token=NULL,reason='The run left an external action with an unknown outcome; reconcile it before this work continues',updated_at=? WHERE key=?`).run(now, row.key)
      else if (wrote) this.store.db.prepare(`UPDATE work_items SET state='blocked',claim_token=NULL,reason='The run changed an application before it ended; review what happened before this work continues',updated_at=? WHERE key=?`).run(now, row.key)
      else this.store.db.prepare(`UPDATE work_items SET state=?,claim_token=NULL,ready_at=?,reason='The run ended before this work was completed',updated_at=? WHERE key=?`).run(row.attempt >= workLimits.attempts ? 'blocked' : 'retry_wait', now + backoff[Math.min(row.attempt - 1, backoff.length - 1)]!, now, row.key)
    }
  }

  /**
   * Claims of runs that ended without settling them (a crash, an owner recovery). An interrupted run keeps its claims
   * until recovery proved its processes stopped, so a still running process cannot race a new claimant.
   */
  settleOrphans(): void {
    for (const row of this.store.db.prepare(`SELECT DISTINCT w.run_id FROM work_items w LEFT JOIN runs r ON r.id=w.run_id WHERE w.state='claimed'
      AND (r.id IS NULL OR r.state NOT IN ('running','interrupted')) AND NOT EXISTS(SELECT 1 FROM run_leases l WHERE l.run_id=w.run_id)`).all()) this.settleRun(String(row.run_id))
  }

  /** Whether a scheduled run of this Pod has something to do; discovery runs first, so new inputs count. */
  pending(podId: string): boolean {
    let names: string[]
    try {
      // A polling source reads an external system on its schedule; only that run can tell whether something changed.
      if (this.manifest(podId)?.polls) return true
      names = this.declarations(podId).map(item => item.operation)
    }
    catch { return true }
    if (!names.length) return true
    return this.store.transaction(() => { this.settleOrphans(); return names }).some(name => this.store.transaction(() => {
      const operation = this.store.db.prepare('SELECT * FROM work_operations WHERE operation=?').get(name) as unknown as OperationRow | undefined
      if (!operation) return true
      this.discover(operation)
      return !!this.store.db.prepare(`SELECT 1 FROM work_items WHERE operation=? AND (state='ready' OR (state IN ('retry_wait','waiting') AND ready_at<=?)) LIMIT 1`).get(name, Date.now())
    }))
  }

  /**
   * Owner command: selects the contract and rule version the serving Pod's active script declares for an operation;
   * objects whose result depends on the change become work again.
   */
  selectRule(name: string, ruleVersion: number): void {
    const operation = this.operation(name)
    const writer = this.data.namespace(operation.output).writer
    const declaration = writer === ownerWriter ? undefined : this.declarations(writer).find(item => item.operation === name)
    if (!declaration) throw new Error(`No active script serves ${name}`)
    if (!declaration.ruleVersions.includes(ruleVersion)) throw new Error(`The active script of ${name} does not implement rule version ${ruleVersion}`)
    this.data.namespace(declaration.input)
    if (this.data.namespace(declaration.output).writer !== writer) throw new Error(`The serving Pod is not the writer of ${declaration.output}`)
    this.store.db.prepare('UPDATE work_operations SET input=?,output=?,fields=?,filter=?,rule_version=?,cursor=0,updated_at=? WHERE operation=?')
      .run(declaration.input, declaration.output, JSON.stringify(declaration.fields), canonicalJson(declaration.filter), ruleVersion, Date.now(), name)
  }

  /** Owner command: reprocesses every object of an operation once more; earlier external actions keep their own identities. */
  reprocess(name: string): void {
    this.store.db.prepare('UPDATE work_operations SET generation=generation+1,cursor=0,updated_at=? WHERE operation=?').run(Date.now(), this.operation(name).operation)
  }

  /** Owner command: releases blocked or unknown work after the owner reconciled what happened. */
  release(key: string, evidence: string): void {
    if (!String(evidence ?? '').trim()) throw new Error('Releasing held work needs the owner\'s observation')
    const changed = this.store.db.prepare(`UPDATE work_items SET state='retry_wait',ready_at=?,reason=?,updated_at=? WHERE key=? AND state IN ('blocked','unknown')`).run(Date.now(), `Released by the owner: ${String(evidence).slice(0, 1800)}`, Date.now(), key)
    if (changed.changes !== 1) throw new Error('Only blocked or unknown work can be released')
  }

  counts(name?: string): Record<string, Record<WorkState, number>> {
    const result: Record<string, Record<WorkState, number>> = {}
    for (const row of this.store.db.prepare(`SELECT operation,state,count(*) AS count FROM work_items ${name ? 'WHERE operation=?' : ''} GROUP BY operation,state`).all(...(name ? [name] : []))) {
      const entry = result[String(row.operation)] ??= { ready: 0, claimed: 0, completed: 0, retry_wait: 0, waiting: 0, blocked: 0, unknown: 0, superseded: 0 }
      entry[row.state as WorkState] = Number(row.count)
    }
    return result
  }

  items(name: string, states: WorkState[] = open, limit = 50): WorkItemView[] {
    const marks = states.map(() => '?').join(',')
    return this.store.db.prepare(`SELECT * FROM work_items WHERE operation=? AND state IN (${marks}) ORDER BY updated_at DESC LIMIT ?`).all(name, ...states, limit).map(row => this.view(row as unknown as ItemRow))
  }
}
