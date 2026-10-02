import { retryReady } from '../scheduling/retry'
import { randomUUID } from 'node:crypto'
import type { WorkflowCommand, WorkflowDefinition, WorkflowRunView, WorkflowView } from '../../contracts/workflows'
import { parseWorkflowCommand } from '../../contracts/workflows'
import { graphDiagnosticMessages } from '../../contracts/graphs'
import type { GraphMode } from '../../contracts/graphs'
import { graphNodes, hasPendingItems, inspectGraph, podContracts } from './items'
import type { GraphNode } from './items'
import { closeCalledGates, gateNeedsRound, gateView } from './gates'
import type { PodDatabase } from '../storage/database'
import type { RunTrigger } from '../runs/store'
import { nextWorkflowDue } from './clock'
import { loadWorkflowRevision, publishWorkflowRevision } from './revisions'
import type { WorkflowRevision } from './revisions'
import { assertNetworkQuota } from '../scheduling/network-quota'

interface Driver { start: (podId: string, trigger: RunTrigger) => string, cancelPod: (podId: string) => void }
interface Recovery { inspect: (podId: string, runId: string) => Promise<void> }
export function workflowDefinitions(store: PodDatabase): WorkflowDefinition[] {
  const parts = (table: string, id: string) => store.db.prepare(`SELECT * FROM ${table} WHERE workflow_id=? ORDER BY rowid`).all(id)
  return store.db.prepare('SELECT * FROM workflows WHERE archived=0 ORDER BY rowid').all().map((row) => {
    const id = row.id as string
    return {
      id,
      revision: row.revision as number,
      name: row.name as string,
      nodes: JSON.parse(row.nodes as string),
      schedule: row.schedule ? JSON.parse(row.schedule as string) : null,
      enabled: row.enabled === 1,
      paused: row.paused === 1,
      nextAt: row.next_at as number | null,
      ...(row.mail ? { mail: JSON.parse(row.mail as string) } : {}),
      mode: row.mode as GraphMode,
      groupId: row.group_id as string | null,
      channels: parts('workflow_channels', id).map(item => ({ name: item.name as string, title: item.title as string, fields: JSON.parse(item.fields as string) })),
      gates: parts('workflow_gates', id).map(item => JSON.parse(item.definition as string)),
      values: parts('workflow_values', id).map(item => ({ name: item.name as string, value: item.value as string, revision: item.revision as number })),
    }
  })
}
/** The Pods whose items can reach a node in this run. A gate never runs, so the Pods before it count instead. */
function podsBefore(graph: GraphNode[], id: string): string[] {
  const found = new Set<string>(); const seen = new Set<string>(); const pending = [id]
  while (pending.length) {
    const next = pending.pop()
    const current = graph.find(node => node.id === next)
    if (!current || seen.has(current.id)) continue
    seen.add(current.id)
    for (const giver of graph.filter(node => node.id !== id && node.gives.some(channel => current.takes.includes(channel)))) {
      if (giver.id.startsWith('gate:')) pending.push(giver.id)
      else found.add(giver.id)
    }
  }
  return [...found]
}
interface NodeRow { pod_id: string, script_hash: string | null, assignment_revision: number, resource_epoch: number, state: string, run_id: string | null, reason: string | null, output: string | null }
export class WorkflowEngine {
  callAuthority: ((requestId: string) => void) | null = null
  constructor(private readonly store: PodDatabase, private readonly driver: Driver, private readonly recovery: Recovery, private readonly now: () => number = Date.now, private readonly immediateDispatch = true) {}

  view(): WorkflowView {
    const workflows = workflowDefinitions(this.store)
    const runs = this.store.db.prepare('SELECT id FROM workflow_runs ORDER BY finished_at IS NULL DESC,started_at DESC,rowid DESC LIMIT 100').all().map(row => this.run(row.id as string))
    return { workflows, runs, gates: gateView(this.store), contracts: podContracts(this.store) }
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
    return { id, revisionKind: row.trigger === 'network-call' ? 'published' : 'composition', paused: row.paused === 1, workflowId: row.workflow_id as string, revision: row.revision as number, state: row.state as WorkflowRunView['state'], reason: row.reason as string | null, startedAt: row.started_at as number, finishedAt: row.finished_at as number | null, nodes: this.nodes(id).map(node => ({ ...definition.nodes.find(item => item.podId === node.pod_id)!, state: node.state as WorkflowRunView['nodes'][number]['state'], runId: node.run_id, reason: node.reason, scriptHash: node.script_hash })) }
  }

  save(command: Extract<WorkflowCommand, { type: 'save' }>): void {
    const parsed = parseWorkflowCommand(command) as Required<typeof command>
    this.store.transaction(() => {
      const row = this.store.db.prepare('SELECT revision,schedule,next_at,archived FROM workflows WHERE id=?').get(parsed.id)
      if (row?.archived === 1) throw new Error('Workflow not found')
      if ((row?.revision ?? 0) !== parsed.revision) throw new Error('Workflow changed; reload before saving')
      if (!row && (this.store.db.prepare('SELECT count(*) AS count FROM workflows').get()!.count as number) >= 1000) throw new Error('Workflow limit reached')
      for (const node of parsed.nodes) {
        if (this.store.db.prepare('SELECT 1 FROM network_members WHERE pod_id=?').get(node.podId)) throw new Error('Network instances cannot join legacy workflows; create a separate instance')
        if (this.store.getPod(node.podId).lifecycle === 'archived') throw new Error('Archived pods cannot join workflows')
      }
      const schedule = parsed.schedule ? JSON.stringify(parsed.schedule) : null
      const nextAt = schedule === row?.schedule ? row.next_at as number | null : parsed.schedule ? nextWorkflowDue(parsed.schedule, null, this.now()) : null
      if (parsed.groupId && !this.store.db.prepare('SELECT 1 FROM pod_groups WHERE id=?').get(parsed.groupId)) throw new Error('Graph group not found')
      const names = JSON.stringify(parsed.values.map(value => value.name)); const members = JSON.stringify(parsed.nodes.map(node => node.podId))
      if (this.store.db.prepare('SELECT 1 FROM pod_variables WHERE name IN (SELECT value FROM json_each(?)) AND pod_id IN (SELECT value FROM json_each(?))').get(names, members)) throw new Error(graphDiagnosticMessages['value-name-conflict'])
      this.store.db.prepare('INSERT INTO workflows(id,revision,name,nodes,schedule,enabled,next_at,mail,mode,group_id) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,name=excluded.name,nodes=excluded.nodes,schedule=excluded.schedule,enabled=excluded.enabled,next_at=excluded.next_at,mail=excluded.mail,mode=excluded.mode,group_id=excluded.group_id').run(parsed.id, parsed.revision + 1, parsed.name, JSON.stringify(parsed.nodes), schedule, Number(parsed.enabled), nextAt, parsed.mail ? JSON.stringify(parsed.mail) : null, parsed.mode, parsed.groupId)
      this.store.db.prepare('DELETE FROM workflow_channels WHERE workflow_id=?').run(parsed.id)
      for (const channel of parsed.channels) this.store.db.prepare('INSERT INTO workflow_channels VALUES(?,?,?,?)').run(parsed.id, channel.name, channel.title, JSON.stringify(channel.fields))
      this.store.db.prepare('DELETE FROM workflow_gates WHERE workflow_id=?').run(parsed.id)
      for (const gate of parsed.gates) this.store.db.prepare('INSERT INTO workflow_gates VALUES(?,?,?)').run(parsed.id, gate.key, JSON.stringify(gate))
      this.store.db.prepare('DELETE FROM workflow_values WHERE workflow_id=? AND name NOT IN (SELECT value FROM json_each(?))').run(parsed.id, names)
      for (const value of parsed.values) this.store.db.prepare('INSERT INTO workflow_values VALUES(?,?,?,1) ON CONFLICT(workflow_id,name) DO UPDATE SET revision=revision+1,value=excluded.value WHERE value!=excluded.value').run(parsed.id, value.name, value.value)
      this.store.db.prepare('DELETE FROM workflow_members WHERE workflow_id=?').run(parsed.id)
      for (const node of parsed.nodes) this.store.db.prepare('INSERT INTO workflow_members VALUES(?,?)').run(parsed.id, node.podId)
      if (parsed.enabled) this.assertRunnable(this.definition(parsed.id))
    })
  }

  /** A channel graph with any diagnostic neither starts nor becomes enabled. */
  private assertRunnable(definition: WorkflowDefinition): void {
    if (definition.mode !== 'channels') return
    const [first] = inspectGraph(this.store, definition).diagnostics
    if (first) throw new Error(first.message)
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

  start(id: string, revision: number, trigger = 'manual', operationId?: string): string {
    return this.store.transaction(() => {
      const definition = this.definition(id)
      if (definition.revision !== revision) throw new Error('Workflow changed; reload before running')
      this.assertRunnable(definition)
      const active = this.store.db.prepare('SELECT id,trigger FROM workflow_runs WHERE workflow_id=? AND finished_at IS NULL').get(id)
      if (active) {
        if (active.trigger === 'network-call') throw new Error('An accepted workflow call owns the active execution')
        if (operationId) this.store.db.prepare('INSERT INTO control_runs VALUES(?,?,\'workflow\')').run(operationId, active.id)
        return active.id as string
      }
      const runId = randomUUID()
      this.store.db.prepare('INSERT INTO workflow_runs(id,workflow_id,revision,definition,trigger,state,reason,started_at,finished_at) VALUES(?,?,?,?,?,?,NULL,?,NULL)').run(runId, id, revision, JSON.stringify(definition), trigger, 'waiting', this.now())
      if (operationId) this.store.db.prepare('INSERT INTO control_runs VALUES(?,?,\'workflow\')').run(operationId, runId)
      for (const node of definition.nodes) {
        const pod = this.store.getPod(node.podId)
        const epoch = this.store.db.prepare('SELECT epoch FROM resource_epochs WHERE pod_id=?').get(pod.id)?.epoch as number ?? 0
        this.store.db.prepare('INSERT INTO workflow_nodes VALUES(?,?,?,?,?,\'waiting\',NULL,NULL,NULL)').run(runId, pod.id, pod.activeScript, pod.bindingRevision, epoch)
      }
      return runId
    })
  }

  publishRevision(id: string, revision: number, ports: unknown): WorkflowRevision {
    const definition = this.definition(id)
    if (definition.revision !== revision) throw new Error('Workflow changed; reload before publishing')
    this.assertRunnable(definition)
    return publishWorkflowRevision(this.store, definition, ports, this.now())
  }

  startRevision(id: string, revision: number): string {
    return this.store.transaction(() => {
      const current = this.definition(id)
      if (current.paused) throw new Error('Called workflow is paused by the owner')
      if (this.store.db.prepare('SELECT 1 FROM workflow_runs WHERE workflow_id=? AND finished_at IS NULL').get(id)) throw new Error('Called workflow is waiting for its active execution')
      const { published } = loadWorkflowRevision(this.store, id, revision)
      assertNetworkQuota(this.store, 16384 + published.pins.length * 4096)
      this.assertRunnable(published.definition)
      for (const pin of published.pins) this.assertPinned({ pod_id: pin.podId, script_hash: pin.scriptHash, assignment_revision: pin.bindingRevision, resource_epoch: pin.resourceEpoch, state: 'waiting', run_id: null, reason: null, output: null })
      const runId = randomUUID()
      this.store.db.prepare('INSERT INTO workflow_runs(id,workflow_id,revision,definition,trigger,state,reason,started_at,finished_at) VALUES(?,?,?,?,?,\'waiting\',NULL,?,NULL)').run(runId, id, revision, JSON.stringify(published.definition), 'network-call', this.now())
      for (const pin of published.pins) this.store.db.prepare('INSERT INTO workflow_nodes VALUES(?,?,?,?,?,\'waiting\',NULL,NULL,NULL)').run(runId, pin.podId, pin.scriptHash, pin.bindingRevision, pin.resourceEpoch)
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
    const call = this.store.db.prepare('SELECT c.id,c.state,control.cancellation_receipt FROM workflow_call_requests c JOIN workflow_call_controls control ON control.request_id=c.id WHERE c.workflow_run_id=?').get(id)
    if (call && (call.state !== 'running' || call.cancellation_receipt)) return false
    if (call && this.nodes(id).some(node => node.state !== 'completed')) {
      if (!this.callAuthority) throw new Error('Called workflow authority coordinator is unavailable')
      this.callAuthority(call.id as string)
    }
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
      if (this.store.db.prepare('SELECT 1 FROM workflow_runs WHERE workflow_id=? AND trigger=\'network-call\' AND finished_at IS NULL').get(definition.id)) continue
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
    // Run snapshots written before graphs existed carry no mode.
    const graph = definition.mode === 'channels' ? graphNodes(this.store, id, definition) : null
    const called = this.store.db.prepare('SELECT id,workflow_id,workflow_revision FROM workflow_call_requests WHERE workflow_run_id=?').get(id)
    const requiredGates = called ? loadWorkflowRevision(this.store, called.workflow_id as string, Number(called.workflow_revision)).published.ports.requiredGates : []
    for (const node of this.nodes(id)) {
      if (node.state !== 'waiting') continue
      const spec = definition.nodes.find(item => item.podId === node.pod_id)!
      const takes = graph?.find(item => item.id === node.pod_id)!.takes ?? []
      const producers = graph ? podsBefore(graph, node.pod_id) : undefined
      const predecessors = this.nodes(id).filter(other => (producers ?? spec.after).includes(other.pod_id))
      if (predecessors.some(other => other.state !== 'completed')) {
        this.store.db.prepare('UPDATE workflow_nodes SET reason=? WHERE workflow_run_id=? AND pod_id=?').run(predecessors.some(other => other.state === 'blocked') ? 'Blocked by a predecessor' : 'Waiting for all predecessors to complete', id, node.pod_id)
        continue
      }
      if (spec.handoff && predecessors.some(other => !other.output)) {
        this.store.db.prepare('UPDATE workflow_nodes SET state=\'blocked\',reason=\'A required predecessor output is missing\' WHERE workflow_run_id=? AND pod_id=? AND state=\'waiting\'').run(id, node.pod_id)
        continue
      }
      // The Pod behind an approval gate asks for the decision, so it also runs while the gate holds items.
      const waiting = definition.gates?.some(gate => gate.kind === 'approve' && takes.includes(gate.gives) && gateNeedsRound(this.store, row.workflow_id as string, gate.key, id))
      const required = (definition.gates ?? []).filter(gate => requiredGates.includes(gate.key) && (gate.kind === 'approve' ? takes.includes(gate.gives) : gate.options.some(option => takes.includes(option.channel))) && gateNeedsRound(this.store, row.workflow_id as string, gate.key, id))
      const waitingExcluded = called && (definition.gates ?? []).some(gate => gate.kind === 'approve' && gate.excluded !== null && takes.includes(gate.excluded) && !takes.includes(gate.gives) && gateNeedsRound(this.store, row.workflow_id as string, gate.key, id))
      if (waitingExcluded || required.some(gate => gate.kind === 'choose')) {
        this.store.db.prepare('UPDATE workflow_nodes SET reason=\'Waiting for required owner decisions\' WHERE workflow_run_id=? AND pod_id=?').run(id, node.pod_id)
        continue
      }
      if (required.length && Number(this.store.db.prepare('SELECT next_poll_at FROM workflow_gate_poll_clocks WHERE request_id=? AND pod_id=?').get(called!.id!, node.pod_id)?.next_poll_at ?? 0) > this.now()) continue
      if (takes.length && !waiting && !hasPendingItems(this.store, row.workflow_id as string, node.pod_id, id)) {
        this.store.db.prepare('UPDATE workflow_nodes SET state=\'completed\',reason=\'No items to process\' WHERE workflow_run_id=? AND pod_id=? AND state=\'waiting\'').run(id, node.pod_id)
        continue
      }
      const count = this.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count as number
      const maximum = this.store.db.prepare('SELECT concurrency FROM settings WHERE id=1').get()!.concurrency as number
      if (count >= maximum) { this.store.db.prepare('UPDATE workflow_nodes SET reason=? WHERE workflow_run_id=? AND pod_id=?').run('Waiting for an execution slot', id, node.pod_id); continue }
      try {
        this.assertPinned(node)
        if (!retryReady(this.store, node.pod_id, node.run_id, this.now(), false)) continue
        this.driver.start(node.pod_id, { reason: row.trigger === 'schedule' ? 'schedule' : 'manual', eventIds: [], workflowRunId: id, ...(required.length ? { workflowGateOnly: required.map(gate => gate.key) } : {}) })
      }
      catch (error) { this.store.db.prepare('UPDATE workflow_nodes SET state=\'blocked\',reason=? WHERE workflow_run_id=? AND pod_id=? AND state=\'waiting\'').run(error instanceof Error ? error.message : 'Workflow node could not start', id, node.pod_id) }
    }
    const nodes = this.nodes(id)
    let completed = nodes.every(node => node.state === 'completed')
    let requiredReason: string | null = null
    let failed = false
    const call = this.store.db.prepare('SELECT workflow_id,workflow_revision FROM workflow_call_requests WHERE workflow_run_id=?').get(id)
    if (completed && call) {
      const { published } = loadWorkflowRevision(this.store, call.workflow_id as string, Number(call.workflow_revision))
      const missing = published.ports.requiredTerminals.filter((podId) => {
        const node = nodes.find(node => node.pod_id === podId)
        return !node?.run_id || !!this.store.db.prepare('SELECT 1 FROM workflow_gate_attempts WHERE run_id=?').get(node.run_id)
      })
      const held = published.ports.requiredGates.filter(key => gateNeedsRound(this.store, row.workflow_id as string, key, id))
      const remaining = nodes.some(node => hasPendingItems(this.store, row.workflow_id as string, node.pod_id, id))
      if (missing.length || held.length || remaining) {
        completed = false
        failed = missing.length > 0 && held.length === 0 && !remaining && missing.every(podId => published.definition.gates.some((gate) => {
          const takes = graph?.find(node => node.id === podId)?.takes ?? []
          const channels = gate.kind === 'approve' ? [gate.gives] : gate.options.map(option => option.channel)
          return channels.some(channel => takes.includes(channel)) && !!this.store.db.prepare('SELECT 1 FROM graph_item_events WHERE workflow_run_id=? AND node=? AND outcome IN (\'refused\',\'expired\',\'excluded\',\'chosen\') LIMIT 1').get(id, `gate:${gate.key}`)
        }))
        requiredReason = failed ? 'A required terminal branch was prevented by an owner decision' : remaining ? 'Completed workflow steps retain unprocessed inputs; owner review is required' : missing.length ? 'A required terminal branch did not execute; owner review is required' : 'Waiting for required owner decisions'
      }
    }
    const blocked = nodes.some(node => node.state === 'blocked')
    this.store.transaction(() => {
      this.store.db.prepare('UPDATE workflow_runs SET state=?,reason=?,finished_at=? WHERE id=?').run(completed ? 'completed' : failed ? 'failed' : blocked || requiredReason?.includes('review') ? 'blocked' : 'running', requiredReason ?? (blocked ? 'Review blocked nodes before continuing' : null), completed || failed ? this.now() : null, id)
      if (completed || failed) this.store.db.prepare('DELETE FROM workflow_reservations WHERE workflow_run_id=?').run(id)
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
    if (this.immediateDispatch) this.tick()
  }

  async inspectCall(id: string): Promise<void> {
    for (const node of this.nodes(id)) {
      if (node.run_id) {
        const run = this.store.db.prepare('SELECT state FROM runs WHERE id=?').get(node.run_id)!
        if (run.state === 'running') throw new Error('Stop called workflow processes before owner recovery')
        if (run.state !== 'completed') await this.recovery.inspect(node.pod_id, node.run_id)
      }
      if (this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=? UNION ALL SELECT 1 FROM effect_ledger WHERE pod_id=? AND state!=\'completed\' LIMIT 1').get(node.pod_id, node.pod_id)) throw new Error('Called workflow processes or effects still need review')
      if (this.row(id).finished_at === null) this.assertPinned(node)
    }
  }

  async cancel(id: string): Promise<void> {
    if (this.row(id).finished_at !== null) return
    if (this.store.db.prepare('SELECT 1 FROM workflow_call_requests c JOIN workflow_call_controls control ON control.request_id=c.id WHERE c.workflow_run_id=? AND control.cancellation_receipt IS NULL').get(id)) throw new Error('Cancel called workflows through their request with owner evidence')
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
      if (this.store.db.prepare('SELECT 1 FROM workflow_call_requests WHERE workflow_run_id=?').get(id)) closeCalledGates(this.store, id, this.now())
      this.store.db.prepare('UPDATE workflow_runs SET state=\'cancelled\',finished_at=?,reason=NULL WHERE id=?').run(this.now(), id)
      this.store.db.prepare('DELETE FROM workflow_reservations WHERE workflow_run_id=?').run(id)
    })
  }
}
