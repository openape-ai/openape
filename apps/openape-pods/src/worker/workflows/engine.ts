import { randomUUID } from 'node:crypto'
import type { WorkflowCommand, WorkflowDefinition, WorkflowRunView, WorkflowView } from '../../contracts/workflows'
import { parseWorkflowCommand } from '../../contracts/workflows'
import type { PodDatabase } from '../storage/database'
import type { RunTrigger } from '../runs/store'
import { nextWorkflowDue } from './clock'

interface Driver { start: (podId: string, trigger: RunTrigger) => string, cancelPod: (podId: string) => void }
interface Recovery { inspect: (podId: string, runId: string) => Promise<void> }
interface NodeRow { pod_id: string, script_hash: string | null, assignment_revision: number, resource_epoch: number, state: string, run_id: string | null, reason: string | null, output: string | null }
export class WorkflowEngine {
  constructor(private readonly store: PodDatabase, private readonly driver: Driver, private readonly recovery: Recovery, private readonly now: () => number = Date.now) {}

  view(): WorkflowView {
    const workflows = this.store.db.prepare('SELECT * FROM workflows WHERE archived=0 ORDER BY rowid').all().map(row => ({ id: row.id as string, revision: row.revision as number, name: row.name as string, nodes: JSON.parse(row.nodes as string), schedule: row.schedule ? JSON.parse(row.schedule as string) : null, enabled: row.enabled === 1, paused: row.paused === 1, nextAt: row.next_at as number | null, ...(row.mail ? { mail: JSON.parse(row.mail as string) } : {}) }))
    const runs = this.store.db.prepare('SELECT id FROM workflow_runs ORDER BY finished_at IS NULL DESC,started_at DESC,rowid DESC LIMIT 100').all().map(row => this.run(row.id as string))
    return { workflows, runs }
  }

  private definition(id: string): WorkflowDefinition {
    const definition = this.view().workflows.find(workflow => workflow.id === id)
    if (!definition) throw new Error('Workflow not found')
    return definition
  }

  private row(id: string) {
    const row = this.store.db.prepare('SELECT * FROM workflow_runs WHERE id=?').get(id)
    if (!row) throw new Error('Workflow run not found')
    return row
  }

  private nodes(id: string): NodeRow[] { return this.store.db.prepare('SELECT * FROM workflow_nodes WHERE workflow_run_id=? ORDER BY rowid').all(id) as unknown as NodeRow[] }

  run(id: string): WorkflowRunView {
    const row = this.row(id); const definition = JSON.parse(row.definition as string) as WorkflowDefinition
    return { id, paused: row.paused === 1, workflowId: row.workflow_id as string, revision: row.revision as number, state: row.state as WorkflowRunView['state'], reason: row.reason as string | null, startedAt: row.started_at as number, finishedAt: row.finished_at as number | null, nodes: this.nodes(id).map(node => ({ ...definition.nodes.find(item => item.podId === node.pod_id)!, state: node.state as WorkflowRunView['nodes'][number]['state'], runId: node.run_id, reason: node.reason, scriptHash: node.script_hash })) }
  }

  save(command: Extract<WorkflowCommand, { type: 'save' }>): void {
    const parsed = parseWorkflowCommand(command) as typeof command
    this.store.transaction(() => {
      const row = this.store.db.prepare('SELECT revision,schedule,next_at,archived FROM workflows WHERE id=?').get(parsed.id)
      if (row?.archived === 1) throw new Error('Workflow not found')
      if ((row?.revision ?? 0) !== parsed.revision) throw new Error('Workflow changed; reload before saving')
      if (!row && (this.store.db.prepare('SELECT count(*) AS count FROM workflows').get()!.count as number) >= 1000) throw new Error('Workflow limit reached')
      for (const node of parsed.nodes) {
        if (this.store.getPod(node.podId).lifecycle === 'archived') throw new Error('Archived pods cannot join workflows')
      }
      const schedule = parsed.schedule ? JSON.stringify(parsed.schedule) : null
      const nextAt = schedule === row?.schedule ? row.next_at as number | null : parsed.schedule ? nextWorkflowDue(parsed.schedule, null, this.now()) : null
      this.store.db.prepare('INSERT INTO workflows(id,revision,name,nodes,schedule,enabled,next_at,mail) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,name=excluded.name,nodes=excluded.nodes,schedule=excluded.schedule,enabled=excluded.enabled,next_at=excluded.next_at,mail=excluded.mail').run(parsed.id, parsed.revision + 1, parsed.name, JSON.stringify(parsed.nodes), schedule, Number(parsed.enabled), nextAt, parsed.mail ? JSON.stringify(parsed.mail) : null)
      this.store.db.prepare('DELETE FROM workflow_members WHERE workflow_id=?').run(parsed.id)
      for (const node of parsed.nodes) this.store.db.prepare('INSERT INTO workflow_members VALUES(?,?)').run(parsed.id, node.podId)
    })
  }

  delete(id: string, revision: number): void {
    this.store.transaction(() => {
      if (this.store.db.prepare('SELECT 1 FROM workflow_runs WHERE workflow_id=? AND finished_at IS NULL').get(id)) throw new Error('Settle the active workflow run before removing it')
      const changed = this.store.db.prepare('UPDATE workflows SET archived=1,enabled=0,paused=1,revision=revision+1 WHERE id=? AND revision=? AND archived=0').run(id, revision)
      if (changed.changes !== 1) throw new Error('Workflow changed; reload before saving')
      this.store.db.prepare('DELETE FROM workflow_members WHERE workflow_id=?').run(id)
    })
  }

  pause(id: string, revision: number, paused: boolean): void {
    this.store.transaction(() => {
      const changed = this.store.db.prepare('UPDATE workflows SET paused=?,revision=revision+1 WHERE id=? AND revision=?').run(Number(paused), id, revision)
      if (changed.changes !== 1) throw new Error('Workflow changed; reload before saving')
      this.store.db.prepare('UPDATE workflow_runs SET paused=?,reason=? WHERE workflow_id=? AND finished_at IS NULL AND reason IS NOT \'Workflow cancellation requested\'').run(Number(paused), paused ? 'Workflow paused by the owner' : null, id)
    })
  }

  start(id: string, revision: number, trigger = 'manual'): string {
    return this.store.transaction(() => {
      const definition = this.definition(id)
      if (definition.revision !== revision) throw new Error('Workflow changed; reload before running')
      const active = this.store.db.prepare('SELECT id FROM workflow_runs WHERE workflow_id=? AND finished_at IS NULL').get(id)
      if (active) return active.id as string
      const runId = randomUUID()
      this.store.db.prepare('INSERT INTO workflow_runs(id,workflow_id,revision,definition,trigger,state,reason,started_at,finished_at) VALUES(?,?,?,?,?,?,NULL,?,NULL)').run(runId, id, revision, JSON.stringify(definition), trigger, 'waiting', this.now())
      for (const node of definition.nodes) {
        const pod = this.store.getPod(node.podId)
        const epoch = this.store.db.prepare('SELECT epoch FROM resource_epochs WHERE pod_id=?').get(pod.id)?.epoch as number ?? 0
        this.store.db.prepare('INSERT INTO workflow_nodes VALUES(?,?,?,?,?,\'waiting\',NULL,NULL,NULL)').run(runId, pod.id, pod.activeScript, pod.bindingRevision, epoch)
      }
      return runId
    })
  }

  private assertPinned(node: NodeRow): void {
    const pod = this.store.getPod(node.pod_id)
    const epoch = this.store.db.prepare('SELECT epoch FROM resource_epochs WHERE pod_id=?').get(pod.id)?.epoch ?? 0
    if (!node.script_hash || pod.lifecycle === 'archived' || pod.activeScript !== node.script_hash || pod.bindingRevision !== node.assignment_revision || epoch !== node.resource_epoch) throw new Error('Workflow permissions or script changed; review and start a new run')
    if (!this.store.db.prepare('SELECT 1 FROM validations WHERE pod_id=? AND script_hash=? AND assignment_revision=? AND resource_epoch=?').get(pod.id, node.script_hash, node.assignment_revision, epoch)) throw new Error('Validate every workflow pod before running')
    if (node.state === 'waiting' && this.store.db.prepare('SELECT 1 FROM effect_ledger WHERE pod_id=? AND state!=\'completed\'').get(pod.id)) throw new Error('An external effect has an unknown outcome; reconciliation evidence is required')
  }

  private reserve(id: string): boolean {
    if (this.store.db.prepare('SELECT 1 FROM workflow_reservations WHERE workflow_run_id=?').get(id)) return true
    return this.store.transaction(() => {
      if (this.row(id).finished_at !== null || this.row(id).paused === 1) return false
      const nodes = this.nodes(id)
      for (const node of nodes) {
        this.assertPinned(node)
        if (this.store.db.prepare('SELECT 1 FROM workflow_reservations WHERE pod_id=? UNION ALL SELECT 1 FROM run_leases WHERE pod_id=? UNION ALL SELECT 1 FROM program_leases WHERE pod_id=? UNION ALL SELECT 1 FROM accepted_events WHERE pod_id=? AND state IN (\'blocked\',\'claimed\') LIMIT 1').get(node.pod_id, node.pod_id, node.pod_id, node.pod_id)) {
          this.store.db.prepare('UPDATE workflow_runs SET reason=? WHERE id=?').run('Waiting for a member pod or unresolved input', id)
          return false
        }
      }
      for (const node of nodes) this.store.db.prepare('INSERT INTO workflow_reservations VALUES(?,?)').run(node.pod_id, id)
      this.store.db.prepare('UPDATE workflow_runs SET state=\'running\',reason=NULL WHERE id=?').run(id)
      return true
    })
  }

  tick(): void {
    for (const definition of this.view().workflows) {
      if (definition.paused || !definition.enabled || !definition.schedule || definition.nextAt === null || definition.nextAt > this.now()) continue
      this.store.transaction(() => {
        this.start(definition.id, definition.revision, 'schedule')
        this.store.db.prepare('UPDATE workflows SET next_at=? WHERE id=?').run(nextWorkflowDue(definition.schedule!, definition.nextAt, this.now()), definition.id)
      })
    }
    for (const row of this.store.db.prepare('SELECT id FROM workflow_runs WHERE finished_at IS NULL ORDER BY started_at,rowid').all()) {
      const id = row.id as string
      try { if (this.reserve(id)) this.advance(id) }
      catch (error) {
        for (const node of this.nodes(id)) {
          if (node.state === 'running') this.driver.cancelPod(node.pod_id)
        }
        this.store.db.prepare('UPDATE workflow_runs SET state=\'blocked\',reason=? WHERE id=?').run(error instanceof Error ? error.message : 'Workflow could not advance', id)
      }
    }
  }

  private advance(id: string): void {
    const row = this.row(id)
    const definition = JSON.parse(row.definition as string) as WorkflowDefinition
    for (const node of this.nodes(id)) {
      if (node.state !== 'running' || !node.run_id) continue
      const run = this.store.db.prepare('SELECT state,error,summary FROM runs WHERE id=?').get(node.run_id)!
      if (run.state === 'running') continue
      const completed = run.state === 'completed'
      this.store.db.prepare('UPDATE workflow_nodes SET state=?,reason=? WHERE workflow_run_id=? AND pod_id=?').run(completed ? 'completed' : 'blocked', completed ? null : run.error ?? run.summary, id, node.pod_id)
    }
    const allCompleted = this.nodes(id).every(node => node.state === 'completed')
    if (row.reason === 'Workflow cancellation requested' || (row.paused === 1 && !allCompleted)) return
    if (!allCompleted) {
      for (const node of this.nodes(id)) this.assertPinned(node)
    }
    for (const node of this.nodes(id)) {
      if (node.state !== 'waiting') continue
      const spec = definition.nodes.find(item => item.podId === node.pod_id)!
      const predecessors = this.nodes(id).filter(other => spec.after.includes(other.pod_id))
      if (predecessors.some(other => other.state !== 'completed')) {
        this.store.db.prepare('UPDATE workflow_nodes SET reason=? WHERE workflow_run_id=? AND pod_id=?').run(predecessors.some(other => other.state === 'blocked') ? 'Blocked by a predecessor' : 'Waiting for all predecessors to complete', id, node.pod_id)
        continue
      }
      if (spec.handoff && predecessors.some(other => !other.output)) {
        this.store.db.prepare('UPDATE workflow_nodes SET state=\'blocked\',reason=\'A required predecessor output is missing\' WHERE workflow_run_id=? AND pod_id=? AND state=\'waiting\'').run(id, node.pod_id)
        continue
      }
      const count = this.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count as number
      const maximum = this.store.db.prepare('SELECT concurrency FROM settings WHERE id=1').get()!.concurrency as number
      if (count >= maximum) { this.store.db.prepare('UPDATE workflow_nodes SET reason=? WHERE workflow_run_id=? AND pod_id=?').run('Waiting for an execution slot', id, node.pod_id); continue }
      try {
        this.assertPinned(node)
        this.driver.start(node.pod_id, { reason: row.trigger === 'schedule' ? 'schedule' : 'manual', eventIds: [], workflowRunId: id })
      }
      catch (error) { this.store.db.prepare('UPDATE workflow_nodes SET state=\'blocked\',reason=? WHERE workflow_run_id=? AND pod_id=? AND state=\'waiting\'').run(error instanceof Error ? error.message : 'Workflow node could not start', id, node.pod_id) }
    }
    const nodes = this.nodes(id)
    const completed = nodes.every(node => node.state === 'completed')
    const blocked = nodes.some(node => node.state === 'blocked')
    this.store.transaction(() => {
      this.store.db.prepare('UPDATE workflow_runs SET state=?,reason=?,finished_at=? WHERE id=?').run(completed ? 'completed' : blocked ? 'blocked' : 'running', blocked ? 'Review blocked nodes before continuing' : null, completed ? this.now() : null, id)
      if (completed) this.store.db.prepare('DELETE FROM workflow_reservations WHERE workflow_run_id=?').run(id)
    })
  }

  async retry(id: string, podId: string): Promise<void> {
    const before = this.row(id)
    if (before.finished_at !== null || before.reason === 'Workflow cancellation requested') throw new Error('Workflow is not available for retry')
    const node = this.nodes(id).find(node => node.pod_id === podId)
    if (!node || node.state !== 'blocked') throw new Error('Only a blocked workflow node can be retried')
    if (node.run_id) await this.recovery.inspect(podId, node.run_id)
    this.store.transaction(() => {
      const current = this.nodes(id).find(item => item.pod_id === podId)!
      if (this.row(id).finished_at !== null || this.row(id).reason === 'Workflow cancellation requested' || current.state !== 'blocked' || current.run_id !== node.run_id) throw new Error('Workflow changed during recovery')
      this.assertPinned(current)
      this.store.db.prepare('UPDATE workflow_nodes SET state=\'waiting\',run_id=NULL,reason=NULL,output=NULL WHERE workflow_run_id=? AND pod_id=?').run(id, podId)
    })
    this.tick()
  }

  async cancel(id: string): Promise<void> {
    if (this.row(id).finished_at !== null) return
    this.store.db.prepare('UPDATE workflow_runs SET state=\'blocked\',reason=\'Workflow cancellation requested\' WHERE id=?').run(id)
    for (const node of this.nodes(id)) {
      if (!node.run_id) continue
      const state = this.store.db.prepare('SELECT state FROM runs WHERE id=?').get(node.run_id)!.state
      if (state === 'running') { this.driver.cancelPod(node.pod_id); continue }
      if (state !== 'completed') await this.recovery.inspect(node.pod_id, node.run_id)
    }
    if (this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id IN (SELECT pod_id FROM workflow_reservations WHERE workflow_run_id=?)').get(id)) return
    if (this.store.db.prepare('SELECT 1 FROM effect_ledger WHERE state!=\'completed\' AND pod_id IN (SELECT pod_id FROM workflow_nodes WHERE workflow_run_id=?)').get(id)) throw new Error('External effects need review')
    this.store.transaction(() => {
      this.store.db.prepare('UPDATE workflow_runs SET state=\'cancelled\',finished_at=?,reason=NULL WHERE id=?').run(this.now(), id)
      this.store.db.prepare('DELETE FROM workflow_reservations WHERE workflow_run_id=?').run(id)
    })
  }
}
