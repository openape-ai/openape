import { dataFields } from '../../contracts/network-data'
import { canonicalNetworkJson } from '../../contracts/network-json'
import { networkDataObject, validateNetworkPayload } from '../../contracts/network-payload'
import { parseWorkflowPortValues, workflowIdentity, workflowPortName } from '../../contracts/workflow-ports'
import type { WorkflowPortValue } from '../../contracts/workflow-ports'
import { parseWorkflowOutput } from '../../contracts/workflows'
import { digest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import type { NetworkAuthority, NetworkEvents } from '../scheduling/network-events'
import { assertNetworkQuota, NetworkQuotaError } from '../scheduling/network-quota'
import type { WorkflowEngine } from './engine'
import { loadWorkflowRevision } from './revisions'
import { parseNetworkDefinition } from '../../contracts/networks'
import { randomUUID } from 'node:crypto'
import { networkDataPin } from '../scheduling/network-config'
import type { Owner } from '@openape/pods-protocol'

export interface WorkflowCallRequest {
  requestId: string
  workflowId: string
  workflowRevision: number
  networkId: string
  networkRevision: number
  podId: string
  caseId: string
  caseRevision: number
  inputs: Record<string, WorkflowPortValue>
  routes: { outputs: Record<string, string>, terminal: string }
  permissionRevision: number
}

export class WorkflowCalls {
  constructor(private readonly store: PodDatabase, private readonly events: NetworkEvents, private readonly engine: WorkflowEngine, private readonly now: () => number = Date.now) {
    engine.callAuthority = (id) => {
      try { this.assertCurrent(this.request(id)) }
      catch (error) { this.block(id, error); throw error }
    }
  }

  stage(authority: NetworkAuthority, value: unknown): { requestId: string, duplicate: boolean } {
    const input = dataFields(value, ['requestId', 'workflowId', 'workflowRevision', 'inputs', 'routes'])
    const requestId = workflowIdentity(input.requestId); const workflowId = workflowIdentity(input.workflowId)
    if (!Number.isSafeInteger(input.workflowRevision) || Number(input.workflowRevision) < 1) throw new Error('Invalid called workflow revision')
    return this.store.transaction(() => {
      const scope = this.events.authority(authority)
      if (scope.row.execution_kind !== 'script' || scope.member.source) throw new Error('Workflow calls require a correlated consumer invocation')
      const cases = this.store.db.prepare('SELECT DISTINCT case_id,case_revision FROM network_deliveries WHERE run_id=? AND state=\'claimed\'').all(authority.runId)
      if (cases.length !== 1) throw new Error('Workflow calls require exactly one case revision')
      const logical = canonicalNetworkJson({ workflowId, workflowRevision: Number(input.workflowRevision), networkId: scope.definition.id, podId: scope.member.podId, caseId: cases[0]!.case_id, caseRevision: cases[0]!.case_revision, inputs: input.inputs, routes: input.routes })
      const logicalKey = digest(logical)
      const retained = this.store.db.prepare('SELECT c.id,control.logical_key FROM workflow_call_requests c JOIN workflow_call_controls control ON control.request_id=c.id WHERE c.id=? OR control.logical_key=? ORDER BY c.rowid').all(requestId, logicalKey)
      for (const receipt of retained) {
        if (receipt.id === requestId && receipt.logical_key !== logicalKey) throw new Error('Workflow request identity conflicts with its accepted receipt')
      }
      const previous = retained.find(receipt => receipt.logical_key === logicalKey)
      if (previous) {
        this.request(previous.id as string)
        return { requestId: previous.id as string, duplicate: true }
      }
      const drafts = this.store.db.prepare('SELECT request_id,logical_key FROM workflow_call_staging WHERE run_id=? AND (request_id=? OR logical_key=?)').all(authority.runId, requestId, logicalKey)
      if (drafts.some(draft => draft.request_id === requestId && draft.logical_key !== logicalKey)) throw new Error('Workflow request identity conflicts with its staged receipt')
      const draft = drafts.find(draft => draft.logical_key === logicalKey)
      if (draft) return { requestId: draft.request_id as string, duplicate: true }
      const permission = this.permission(workflowId, Number(input.workflowRevision), scope.definition.id, scope.member.podId)
      if (JSON.parse(scope.row.manifest as string).dataPin !== networkDataPin(this.store, scope.definition.id, scope.member.podId)) throw new Error('Workflow call permissions changed during this invocation')
      const { published } = loadWorkflowRevision(this.store, workflowId, Number(input.workflowRevision))
      const routes = dataFields(input.routes, ['outputs', 'terminal'])
      const outputs = networkDataObject(routes.outputs)
      if (Object.keys(outputs).length !== published.ports.outputs.length || Object.keys(outputs).some(name => !published.ports.outputs.some(port => port.name === name))) throw new Error('Workflow result routes must cover its published outputs')
      const outputRoutes: Record<string, string> = {}
      for (const port of published.ports.outputs) {
        const name = workflowPortName(outputs[port.name])
        const channel = scope.definition.channels.find(channel => channel.name === name)
        if (!channel || !scope.member.contract.gives.includes(name) || channel.schemaVersion !== port.version || canonicalNetworkJson(channel.schema) !== canonicalNetworkJson(port.schema)) throw new Error('Workflow result route requires a declared matching output channel')
        outputRoutes[port.name] = name
      }
      const terminal = workflowPortName(routes.terminal)
      if (new Set(Object.values(outputRoutes)).size !== Object.keys(outputRoutes).length || Object.values(outputRoutes).includes(terminal)) throw new Error('Workflow result ports require distinct channels')
      const channel = scope.definition.channels.find(channel => channel.name === terminal)
      if (!channel || !scope.member.contract.gives.includes(terminal)) throw new Error('Workflow terminal route requires a declared output channel')
      for (const status of ['completed', 'failed', 'cancelled']) validateNetworkPayload({ requestId, status }, channel.schema)
      const request: WorkflowCallRequest = { requestId, workflowId, workflowRevision: Number(input.workflowRevision), networkId: scope.definition.id, networkRevision: scope.definition.revision, podId: scope.member.podId, caseId: cases[0]!.case_id as string, caseRevision: Number(cases[0]!.case_revision), inputs: parseWorkflowPortValues(input.inputs, published.ports.inputs), routes: { outputs: outputRoutes, terminal }, permissionRevision: Number(permission.revision) }
      const body = canonicalNetworkJson(request); const hash = digest(body)
      if (Number(this.store.db.prepare('SELECT count(*) AS count FROM workflow_call_requests WHERE network_id=? AND finished_at IS NULL').get(request.networkId)!.count) >= 1000) throw new Error('Pending workflow call limit reached')
      assertNetworkQuota(this.store, Buffer.byteLength(body) * 2 + 16384)
      if (Number(this.store.db.prepare('SELECT count(*) AS count FROM workflow_call_staging WHERE run_id=?').get(authority.runId)!.count) >= 32) throw new Error('Workflow call proposals exceed their invocation limit')
      this.store.db.prepare('INSERT INTO workflow_call_staging VALUES(?,?,?,?,?,?,?)').run(authority.runId, requestId, logicalKey, hash, body, scope.row.restore_nonce!, scope.row.activation_epoch!)
      return { requestId, duplicate: false }
    })
  }

  commit(authority: NetworkAuthority): void {
    const scope = this.events.authority(authority, true)
    for (const staged of this.store.db.prepare('SELECT * FROM workflow_call_staging WHERE run_id=? ORDER BY rowid').all(authority.runId)) {
      if (digest(staged.request as string) !== staged.request_hash) throw new Error('Staged workflow request digest changed')
      const request = JSON.parse(staged.request as string) as WorkflowCallRequest
      const permission = this.permission(request.workflowId, request.workflowRevision, request.networkId, request.podId)
      if (request.networkId !== scope.definition.id || request.networkRevision !== scope.definition.revision || request.podId !== scope.member.podId || request.permissionRevision !== permission.revision || staged.restore_nonce !== scope.row.restore_nonce || staged.activation_epoch !== scope.row.activation_epoch) throw new Error('Staged workflow call authority changed before settlement')
      const existing = this.store.db.prepare('SELECT c.id,control.logical_key FROM workflow_call_requests c JOIN workflow_call_controls control ON control.request_id=c.id WHERE c.id=? OR control.logical_key=?').all(request.requestId, staged.logical_key!)
      if (existing.some(receipt => receipt.id === request.requestId && receipt.logical_key !== staged.logical_key)) throw new Error('Workflow call conflicts with an accepted request')
      if (existing.length) continue
      assertNetworkQuota(this.store, Buffer.byteLength(staged.request as string) * 2 + 16384)
      this.store.db.prepare(`INSERT INTO workflow_call_requests(id,caller_run_id,network_id,network_revision,case_id,case_revision,workflow_id,workflow_revision,request_hash,request,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(request.requestId, authority.runId, request.networkId, request.networkRevision, request.caseId, request.caseRevision, request.workflowId, request.workflowRevision, staged.request_hash!, staged.request!, this.now())
      this.store.db.prepare('INSERT INTO workflow_call_controls(request_id,logical_key,permission_revision,restore_nonce,activation_epoch) VALUES(?,?,?,?,?)').run(request.requestId, staged.logical_key!, request.permissionRevision, staged.restore_nonce!, staged.activation_epoch!)
    }
    this.store.db.prepare('DELETE FROM workflow_call_staging WHERE run_id=?').run(authority.runId)
  }

  abandonUnacceptedRetry(runId: string): void {
    const proposals = this.store.db.prepare('SELECT request_id,logical_key,request_hash FROM workflow_call_staging WHERE run_id=? ORDER BY request_id').all(runId)
    if (!proposals.length) return
    const invocation = this.store.db.prepare('SELECT network_id FROM network_invocations WHERE run_id=?').get(runId)!
    this.store.db.prepare('INSERT INTO network_trace_events(network_id,run_id,kind,body,created_at) VALUES(?,?,\'workflow-call-proposals-abandoned\',?,?)').run(invocation.network_id!, runId, canonicalNetworkJson({ proposals, accepted: false, processesStopped: true, decision: 'safe-infrastructure-retry', effectsReplayed: false }), this.now())
    this.store.db.prepare('DELETE FROM workflow_call_staging WHERE run_id=?').run(runId)
  }

  private permission(workflowId: string, workflowRevision: number, networkId: string, podId: string) {
    const permission = this.store.db.prepare(`SELECT p.* FROM workflow_call_permissions p JOIN networks n ON n.id=p.network_id
      WHERE p.workflow_id=? AND p.workflow_revision=? AND p.network_id=? AND p.pod_id=? AND p.enabled=1
      AND p.owner_issuer=n.owner_issuer AND p.owner_subject=n.owner_subject AND p.group_id=n.group_id`).get(workflowId, workflowRevision, networkId, podId)
    if (!permission) throw new Error('Workflow call requires an explicit same-company permission')
    const { published } = loadWorkflowRevision(this.store, workflowId, workflowRevision)
    if (published.definition.groupId !== null && published.definition.groupId !== permission.group_id) throw new Error('Called workflow belongs to another company')
    const current = this.store.db.prepare('SELECT group_id FROM workflows WHERE id=? AND archived=0').get(workflowId)
    if (!current || current.group_id !== permission.group_id || published.definition.groupId !== permission.group_id) throw new Error('Called workflow requires an explicit current company binding')
    for (const node of published.definition.nodes) {
      if (!this.store.db.prepare('SELECT 1 FROM pod_memberships WHERE pod_id=? AND group_id=?').get(node.podId, permission.group_id!)) throw new Error('Called workflow members require the same company binding')
    }
    return permission
  }

  private request(id: string): WorkflowCallRequest {
    const row = this.store.db.prepare('SELECT request,request_hash FROM workflow_call_requests WHERE id=?').get(id)
    if (!row || digest(row.request as string) !== row.request_hash) throw new Error('Workflow request receipt is unavailable or changed')
    return JSON.parse(row.request as string) as WorkflowCallRequest
  }

  private assertCurrent(request: WorkflowCallRequest): void {
    const control = this.store.db.prepare('SELECT * FROM workflow_call_controls WHERE request_id=?').get(request.requestId)
    const network = this.store.db.prepare('SELECT * FROM networks WHERE id=?').get(request.networkId)
    const permission = this.permission(request.workflowId, request.workflowRevision, request.networkId, request.podId)
    if (!control || !network || network.state === 'archived' || network.baseline_state !== 'ready' || network.revision !== request.networkRevision || network.restore_nonce !== control.restore_nonce || network.activation_epoch !== control.activation_epoch || permission.revision !== control.permission_revision) throw new Error('Workflow call authority changed; owner review is required')
  }

  tick(): void {
    for (const row of this.store.db.prepare('SELECT id,workflow_run_id FROM workflow_call_requests WHERE state=\'running\' ORDER BY rowid LIMIT 100').all()) {
      try { this.settle(row.id as string, row.workflow_run_id as string) }
      catch (error) { this.block(row.id as string, error) }
    }
    const queue = this.store.db.prepare(`SELECT c.id FROM workflow_call_requests c JOIN networks caller ON caller.id=c.network_id JOIN pods caller_pod ON caller_pod.id=json_extract(c.request,'$.podId') JOIN workflows definition ON definition.id=c.workflow_id
      WHERE c.state='pending' AND caller.state='active' AND caller_pod.lifecycle='active' AND definition.paused=0 AND definition.archived=0
      AND NOT EXISTS(SELECT 1 FROM workflow_runs active WHERE active.workflow_id=c.workflow_id AND active.finished_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM workflow_call_requests head JOIN networks head_network ON head_network.id=head.network_id JOIN pods head_pod ON head_pod.id=json_extract(head.request,'$.podId') WHERE head.workflow_id=c.workflow_id AND head.finished_at IS NULL AND head.rowid<c.rowid
        AND (head.workflow_run_id IS NOT NULL OR (head.state='pending' AND head_network.state='active' AND head_pod.lifecycle='active'))
        AND (head.workflow_run_id IS NULL OR EXISTS(SELECT 1 FROM workflow_runs execution WHERE execution.id=head.workflow_run_id AND execution.finished_at IS NULL)))
      ORDER BY c.rowid LIMIT 100`).all()
    for (const row of queue) {
      const id = row.id as string
      try {
        this.store.transaction(() => {
          const request = this.request(id)
          this.assertCurrent(request)
          const caller = this.store.db.prepare('SELECT state FROM networks WHERE id=?').get(request.networkId)!
          if (caller.state !== 'active' || this.store.getPod(request.podId).lifecycle !== 'active') return
          const caseRef = this.store.db.prepare('SELECT revision.outcome FROM network_case_revisions revision JOIN network_cases current ON current.id=revision.case_id AND current.current_revision=revision.revision WHERE revision.case_id=? AND revision.revision=?').get(request.caseId, request.caseRevision)
          if (!caseRef || caseRef.outcome !== 'open') throw new Error('Called workflow case revision is no longer open')
          const workflow = this.store.db.prepare('SELECT paused,archived FROM workflows WHERE id=?').get(request.workflowId)
          if (workflow?.archived === 1) throw new Error('Called workflow is archived')
          if (workflow?.paused === 1 || this.store.db.prepare('SELECT 1 FROM workflow_runs WHERE workflow_id=? AND finished_at IS NULL').get(request.workflowId)) return
          const runId = this.engine.startRevision(request.workflowId, request.workflowRevision)
          this.store.db.prepare('UPDATE workflow_call_requests SET workflow_run_id=?,state=\'running\' WHERE id=? AND state=\'pending\'').run(runId, id)
        })
      }
      catch (error) { this.block(id, error) }
    }
    for (const row of this.store.db.prepare(`SELECT c.id FROM workflow_call_requests c JOIN workflow_call_controls control ON control.request_id=c.id JOIN networks caller ON caller.id=c.network_id WHERE c.result IS NOT NULL AND control.delivery_state='pending' AND caller.state='active' AND control.next_delivery_poll_at<=? ORDER BY c.finished_at,c.rowid LIMIT 100`).all(this.now())) {
      try { this.deliver(row.id as string) }
      catch (error) {
        this.store.db.prepare('UPDATE workflow_call_controls SET delivery_state=?,next_delivery_poll_at=?,diagnostic=? WHERE request_id=?').run(error instanceof NetworkQuotaError ? 'pending' : 'blocked', this.now() + 5000, (error instanceof Error ? error.message : 'Workflow result delivery requires owner review').slice(0, 10000), row.id!)
      }
    }
  }

  private block(id: string, error: unknown): void {
    const reason = error instanceof Error ? error.message : 'Workflow call requires owner review'
    this.store.transaction(() => {
      if (error instanceof NetworkQuotaError) {
        this.store.db.prepare('UPDATE workflow_call_controls SET diagnostic=? WHERE request_id=?').run(reason, id)
        return
      }
      this.store.db.prepare('UPDATE workflow_call_requests SET state=\'blocked\' WHERE id=? AND finished_at IS NULL').run(id)
      this.store.db.prepare('UPDATE workflow_call_controls SET diagnostic=? WHERE request_id=?').run(reason.slice(0, 10000), id)
    })
  }

  private settle(id: string, runId: string): void {
    this.store.transaction(() => {
      const request = this.request(id)
      const run = this.store.db.prepare('SELECT state,finished_at FROM workflow_runs WHERE id=?').get(runId)
      if (!run || run.finished_at === null) return
      const outputs: Record<string, WorkflowPortValue> = {}
      if (run.state === 'completed') {
        const { published } = loadWorkflowRevision(this.store, request.workflowId, request.workflowRevision)
        for (const port of published.ports.outputs) {
          const node = this.store.db.prepare('SELECT state,output FROM workflow_nodes WHERE workflow_run_id=? AND pod_id=?').get(runId, port.podId)
          if (node?.state !== 'completed' || !node.output) throw new Error('Required workflow output is missing; completed steps must not be replayed')
          const output = parseWorkflowOutput(JSON.parse(node.output as string))
          if (output.schema !== (port.legacySchema ?? `${port.name}/v${port.version}`)) throw new Error('Workflow output schema does not match its published port')
          outputs[port.name] = { version: port.version, data: validateNetworkPayload(output.data, port.schema) }
        }
      }
      const status = run.state === 'completed' ? 'completed' : run.state === 'cancelled' ? 'cancelled' : 'failed'
      const result = canonicalNetworkJson({ requestId: id, caseId: request.caseId, caseRevision: request.caseRevision, workflowRunId: runId, status, outputs })
      assertNetworkQuota(this.store, Buffer.byteLength(result) + 8192)
      this.store.db.prepare('UPDATE workflow_call_requests SET state=?,result=?,finished_at=? WHERE id=? AND finished_at IS NULL').run(status, result, this.now(), id)
      this.store.db.prepare('UPDATE workflow_call_controls SET cancellation_receipt=json_set(cancellation_receipt,\'$.outcome\',?,\'$.finishedAt\',?) WHERE request_id=? AND cancellation_receipt IS NOT NULL').run(status, this.now(), id)
    })
  }

  result(authority: NetworkAuthority, value: unknown): unknown {
    const { requestId } = dataFields(value, ['requestId'])
    workflowIdentity(requestId)
    return this.store.transaction(() => {
      const scope = this.events.authority(authority)
      const request = this.request(requestId as string)
      const caseRef = this.store.db.prepare('SELECT 1 FROM network_deliveries WHERE run_id=? AND state=\'claimed\' AND case_id=? AND case_revision=?').get(authority.runId, request.caseId, request.caseRevision)
      if (request.networkId !== scope.definition.id || request.podId !== scope.member.podId || !caseRef) throw new Error('Workflow result belongs to another caller or case')
      this.permission(request.workflowId, request.workflowRevision, request.networkId, request.podId)
      const row = this.store.db.prepare('SELECT state,result FROM workflow_call_requests WHERE id=?').get(requestId as string)!
      return { state: row.state, result: row.result ? JSON.parse(row.result as string) : null }
    })
  }

  async resume(id: string, owner: Owner, evidence: string): Promise<void> {
    workflowIdentity(id)
    if (!evidence.trim() || evidence.length > 4000) throw new Error('Workflow call recovery requires owner evidence')
    const request = this.request(id)
    const before = this.store.db.prepare('SELECT state,workflow_run_id,result FROM workflow_call_requests WHERE id=?').get(id)!
    const namespace = this.store.db.prepare('SELECT * FROM networks WHERE id=?').get(request.networkId)!
    if (namespace.owner_issuer !== owner.issuer || namespace.owner_subject !== owner.subject) throw new Error('Workflow call recovery belongs to another owner')
    if (namespace.baseline_state !== 'ready' || namespace.state !== 'active' || namespace.revision !== request.networkRevision) throw new Error('Activate the reviewed caller baseline before call recovery')
    const control = this.store.db.prepare('SELECT * FROM workflow_call_controls WHERE request_id=?').get(id)!
    if (control.delivery_state === 'delivered' || (control.cancellation_receipt && !before.result) || (!['unknown', 'blocked'].includes(before.state as string) && control.delivery_state !== 'blocked')) throw new Error('Workflow call is not awaiting owner recovery')
    if (before.workflow_run_id) await this.engine.inspectCall(before.workflow_run_id as string)
    this.store.transaction(() => {
      const current = this.store.db.prepare('SELECT state,workflow_run_id,result FROM workflow_call_requests WHERE id=?').get(id)!
      const currentControl = this.store.db.prepare('SELECT cancellation_receipt,delivery_state FROM workflow_call_controls WHERE request_id=?').get(id)!
      const network = this.store.db.prepare('SELECT * FROM networks WHERE id=?').get(request.networkId)!
      if (currentControl.cancellation_receipt !== control.cancellation_receipt || currentControl.delivery_state !== control.delivery_state || current.state !== before.state || current.workflow_run_id !== before.workflow_run_id || current.result !== before.result || network.restore_nonce !== namespace.restore_nonce || network.activation_epoch !== namespace.activation_epoch || network.state !== 'active' || network.baseline_state !== 'ready' || network.owner_issuer !== owner.issuer || network.owner_subject !== owner.subject || network.revision !== request.networkRevision) throw new Error('Workflow call changed during owner recovery')
      const permission = this.permission(request.workflowId, request.workflowRevision, request.networkId, request.podId)
      this.store.db.prepare('INSERT INTO network_trace_events(network_id,run_id,kind,body,created_at) VALUES(?,?,\'workflow-call-owner-recovery\',?,?)').run(request.networkId, null, canonicalNetworkJson({ requestId: id, owner, evidence, before: { state: before.state, namespace: control.restore_nonce, permissionRevision: control.permission_revision }, after: { namespace: network.restore_nonce, activationEpoch: network.activation_epoch, permissionRevision: permission.revision }, completedStepsRetained: true, automaticReplayPermitted: false }), this.now())
      this.store.db.prepare('UPDATE workflow_call_controls SET restore_nonce=?,activation_epoch=?,permission_revision=?,delivery_state=\'pending\',next_delivery_poll_at=0,diagnostic=NULL WHERE request_id=?').run(network.restore_nonce!, network.activation_epoch!, permission.revision!, id)
      if (!current.result) this.store.db.prepare('UPDATE workflow_call_requests SET state=? WHERE id=?').run(current.workflow_run_id ? 'running' : 'pending', id)
    })
  }

  async resolveIncompleteResult(id: string, owner: Owner, evidence: string): Promise<void> {
    workflowIdentity(id)
    if (!evidence.trim() || evidence.length > 4000) throw new Error('Incomplete workflow result requires owner evidence')
    const request = this.request(id)
    const before = this.store.db.prepare('SELECT state,workflow_run_id,finished_at FROM workflow_call_requests WHERE id=?').get(id)!
    const network = this.store.db.prepare('SELECT owner_issuer,owner_subject FROM networks WHERE id=?').get(request.networkId)!
    if (network.owner_issuer !== owner.issuer || network.owner_subject !== owner.subject) throw new Error('Incomplete workflow result belongs to another owner')
    const run = before.workflow_run_id ? this.store.db.prepare('SELECT state,finished_at FROM workflow_runs WHERE id=?').get(before.workflow_run_id) : undefined
    if (before.finished_at !== null || before.state !== 'blocked' || run?.state !== 'completed' || run.finished_at === null) throw new Error('Only a blocked result of completed work can be resolved')
    await this.engine.inspectCall(before.workflow_run_id as string)
    this.store.transaction(() => {
      const current = this.store.db.prepare('SELECT state,workflow_run_id,finished_at FROM workflow_call_requests WHERE id=?').get(id)!
      const currentOwner = this.store.db.prepare('SELECT owner_issuer,owner_subject FROM networks WHERE id=?').get(request.networkId)!
      if (current.state !== before.state || current.workflow_run_id !== before.workflow_run_id || current.finished_at !== null || currentOwner.owner_issuer !== owner.issuer || currentOwner.owner_subject !== owner.subject) throw new Error('Workflow call changed during owner recovery')
      const result = canonicalNetworkJson({ requestId: id, caseId: request.caseId, caseRevision: request.caseRevision, workflowRunId: before.workflow_run_id, status: 'failed', outputs: {}, reviewedIncompleteResult: true, completedEffectsRetained: true })
      assertNetworkQuota(this.store, Buffer.byteLength(result) + 16384)
      this.store.db.prepare('INSERT INTO network_trace_events(network_id,run_id,kind,body,created_at) VALUES(?,?,\'workflow-call-incomplete-result-reviewed\',?,?)').run(request.networkId, null, canonicalNetworkJson({ requestId: id, owner, evidence, completedWorkflowRunId: before.workflow_run_id, completedEffectsRetained: true, automaticReplayPermitted: false }), this.now())
      this.store.db.prepare('UPDATE workflow_call_requests SET state=\'failed\',result=?,finished_at=? WHERE id=?').run(result, this.now(), id)
      this.store.db.prepare('UPDATE workflow_call_controls SET cancellation_receipt=CASE WHEN cancellation_receipt IS NULL THEN NULL ELSE json_set(cancellation_receipt,\'$.outcome\',\'reviewed-incomplete-result\') END,diagnostic=NULL WHERE request_id=?').run(id)
    })
  }

  async cancel(id: string, owner: Owner, evidence: string): Promise<void> {
    workflowIdentity(id)
    if (!evidence.trim() || evidence.length > 4000) throw new Error('Workflow call cancellation requires owner evidence')
    const row = this.store.transaction(() => {
      const request = this.request(id)
      const network = this.store.db.prepare('SELECT owner_issuer,owner_subject FROM networks WHERE id=?').get(request.networkId)!
      if (network.owner_issuer !== owner.issuer || network.owner_subject !== owner.subject) throw new Error('Workflow call cancellation belongs to another owner')
      const row = this.store.db.prepare('SELECT caller_run_id,workflow_run_id,finished_at FROM workflow_call_requests WHERE id=?').get(id)!
      if (row.finished_at !== null) return row
      const receipt = canonicalNetworkJson({ requestId: id, callerInvocationId: row.caller_run_id, workflowRunId: row.workflow_run_id, caseId: request.caseId, caseRevision: request.caseRevision, owner, evidence, requestedAt: this.now(), outcome: 'requested' })
      assertNetworkQuota(this.store, Buffer.byteLength(receipt) + 16384)
      this.store.db.prepare('INSERT INTO network_trace_events(network_id,run_id,kind,body,created_at) VALUES(?,?,\'workflow-call-cancellation-requested\',?,?)').run(request.networkId, null, receipt, this.now())
      this.store.db.prepare('UPDATE workflow_call_controls SET cancellation_receipt=CASE WHEN cancellation_receipt IS NULL THEN ? ELSE json_set(cancellation_receipt,\'$.outcome\',\'requested\') END WHERE request_id=?').run(receipt, id)
      if (!row.workflow_run_id) {
        const result = canonicalNetworkJson({ requestId: id, caseId: request.caseId, caseRevision: request.caseRevision, workflowRunId: null, status: 'cancelled', outputs: {} })
        this.store.db.prepare('UPDATE workflow_call_requests SET state=\'cancelled\',result=?,finished_at=? WHERE id=?').run(result, this.now(), id)
      }
      return row
    })
    if (row.finished_at !== null || !row.workflow_run_id) return
    await this.engine.cancel(row.workflow_run_id as string)
    this.settle(id, row.workflow_run_id as string)
  }

  async reconcileCancellations(): Promise<void> {
    const rows = this.store.db.prepare(`SELECT c.id,c.workflow_run_id FROM workflow_call_requests c JOIN workflow_call_controls control ON control.request_id=c.id
      WHERE c.finished_at IS NULL AND c.workflow_run_id IS NOT NULL AND json_extract(control.cancellation_receipt,'$.outcome')='requested'
      AND NOT EXISTS(SELECT 1 FROM workflow_nodes node JOIN run_leases lease ON lease.run_id=node.run_id WHERE node.workflow_run_id=c.workflow_run_id)
      ORDER BY c.rowid LIMIT 10`).all()
    for (const row of rows) {
      try {
        await this.engine.cancel(row.workflow_run_id as string)
        this.settle(row.id as string, row.workflow_run_id as string)
      }
      catch (failure) {
        this.store.db.prepare('UPDATE workflow_call_controls SET cancellation_receipt=json_set(cancellation_receipt,\'$.outcome\',\'owner-review-required\') WHERE request_id=?').run(row.id!)
        this.store.db.prepare('UPDATE workflow_call_requests SET state=\'blocked\' WHERE id=? AND finished_at IS NULL').run(row.id!)
        this.store.db.prepare('UPDATE workflow_call_controls SET diagnostic=? WHERE request_id=?').run((failure instanceof Error ? failure.message : 'Workflow cancellation requires owner review').slice(0, 10000), row.id!)
      }
    }
  }

  private deliver(id: string): void {
    this.store.transaction(() => {
      const request = this.request(id)
      const network = this.store.db.prepare('SELECT state FROM networks WHERE id=?').get(request.networkId)
      if (network?.state !== 'active') return
      this.assertCurrent(request)
      const caseRef = this.store.db.prepare('SELECT outcome FROM network_case_revisions WHERE case_id=? AND revision=?').get(request.caseId, request.caseRevision)
      if (caseRef?.outcome !== 'open') throw new Error('Called workflow case revision is no longer open')
      const row = this.store.db.prepare('SELECT state,result FROM workflow_call_requests WHERE id=?').get(id)!
      const result = JSON.parse(row.result as string) as { status: string, outputs: Record<string, WorkflowPortValue> }
      const saved = this.store.db.prepare('SELECT contract FROM network_revisions WHERE network_id=? AND revision=?').get(request.networkId, request.networkRevision)!
      const definition = parseNetworkDefinition(JSON.parse(saved.contract as string))
      const member = definition.members.find(member => member.podId === request.podId)
      const binding = this.store.db.prepare('SELECT * FROM instance_definition_bindings WHERE pod_id=?').get(request.podId)
      if (!member || !binding || binding.definition_id !== member.definitionId || binding.definition_version !== member.definitionVersion || binding.binding_revision !== member.bindingRevision) throw new Error('Workflow result caller binding changed')
      const values = Object.entries(result.outputs).map(([port, output]) => ({ port, channel: request.routes.outputs[port]!, data: output.data }))
      values.push({ port: '$terminal', channel: request.routes.terminal, data: { requestId: id, status: result.status } })
      for (const value of values) {
        const channel = definition.channels.find(channel => channel.name === value.channel)
        if (!channel || !member.contract.gives.includes(channel.name)) throw new Error('Workflow result channel is no longer declared')
        const payload = canonicalNetworkJson(validateNetworkPayload(value.data, channel.schema))
        const schemaHash = digest(canonicalNetworkJson({ schemaVersion: channel.schemaVersion, schema: channel.schema }))
        const subscriptions = this.store.db.prepare('SELECT id,schema_hash FROM network_subscriptions WHERE network_id=? AND network_revision=? AND channel=?').all(request.networkId, request.networkRevision, channel.name)
        assertNetworkQuota(this.store, Buffer.byteLength(payload) * 3 + subscriptions.length * 2048 + 8192)
        const eventId = randomUUID(); const now = this.now()
        const origin = canonicalNetworkJson({ kind: 'workflow-result', requestId: id, workflowRunId: (this.store.db.prepare('SELECT workflow_run_id FROM workflow_call_requests WHERE id=?').get(id)!).workflow_run_id, port: value.port, producerPodId: member.podId, schemaVersion: channel.schemaVersion, occurredAt: now, feedbackHop: 0 })
        this.store.db.prepare('INSERT INTO network_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(eventId, request.networkId, request.networkRevision, member.podId, member.definitionId, member.definitionVersion, request.caseId, request.caseRevision, channel.name, id, origin, schemaHash, payload, digest(payload), now)
        this.store.db.prepare('INSERT INTO network_event_identities VALUES(?,\'derived\',?,?,?,?,?,?,?,NULL)').run(request.networkId, digest(canonicalNetworkJson(['workflow-call-result', id, value.port])), eventId, digest(payload), schemaHash, now, now + 90 * 86400000, canonicalNetworkJson([id]))
        for (const subscription of subscriptions) {
          if (subscription.schema_hash !== schemaHash) throw new Error('Workflow result subscription schema changed')
          this.store.db.prepare('INSERT INTO network_deliveries(id,network_id,event_id,subscription_id,case_id,case_revision,ready_at,accepted_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), request.networkId, eventId, subscription.id!, request.caseId, request.caseRevision, now, now)
        }
        if (subscriptions.length) this.store.db.prepare('INSERT INTO network_queue_counts VALUES(?,\'pending\',?) ON CONFLICT(network_id,state) DO UPDATE SET count=count+excluded.count').run(request.networkId, subscriptions.length)
        this.events.joins.record(eventId)
        this.store.db.prepare('INSERT INTO workflow_call_result_events VALUES(?,?,?)').run(id, value.port, eventId)
        if (value.port === '$terminal') this.store.db.prepare('UPDATE workflow_call_controls SET terminal_event_id=? WHERE request_id=?').run(eventId, id)
      }
      this.store.db.prepare('UPDATE workflow_call_controls SET delivery_state=\'delivered\',diagnostic=NULL WHERE request_id=?').run(id)
    })
  }
}
