import type { ChatModel } from '../../contracts/models'
import { MasterDeadline } from './deadline'
import { LegacyChatAdoption } from './adoption'
import { PodDescriptions } from './descriptions'
import { summarizeConversation } from './summarize'
import { MasterConversations } from './conversations'
import { digest } from '../storage/database'
import { join } from 'node:path'
import type { MasterCommand, MasterView } from '../../contracts/master'
import type { PodDatabase } from '../storage/database'
import type { AgentRuntime } from '../agent/executor'
import type { AgentGatewayServices } from '../agent/gateway'
import { inspectDomainRecords } from '../recovery/domains'
import type { MasterControl } from './control'
import { MasterTransport } from './transport'
import type { MasterFrame } from './transport'

export class MasterService {
  private readonly descriptions: PodDescriptions
  private transport: MasterTransport | null = null
  private controller: AbortController | null = null
  private active: Promise<void> | null = null
  private finish: ((error?: Error) => void) | null = null
  private context = ''
  private actions = 0
  private deadline: MasterDeadline | null = null
  private tools = new Set<Promise<void>>()
  constructor(private readonly store: PodDatabase, private readonly runtime: AgentRuntime, private readonly control: MasterControl, private provider?: AgentGatewayServices['provider']) {
    this.descriptions = new PodDescriptions(store, (input, signal) => summarizeConversation(store, runtime, this.provider, input, signal))
    store.transaction(() => {
      store.db.prepare('UPDATE master_contexts SET state=\'interrupted\',error=\'Previous chat was interrupted.\' WHERE state=\'running\'').run()
      store.db.prepare('UPDATE master_session SET state=\'interrupted\',error=\'Previous chat was interrupted. Inspect its actions before continuing.\',active_turn=NULL WHERE state=\'running\'').run()
      store.db.prepare('UPDATE master_messages SET state=\'interrupted\' WHERE state=\'streaming\'').run()
      store.db.prepare('UPDATE master_actions SET state=\'interrupted\',error=\'Action interrupted; inspect the current pod and draft before retrying\' WHERE state=\'running\'').run()
    })
  }

  setProvider(provider?: AgentGatewayServices['provider']): void {
    this.provider = provider; if (!provider) { this.controller?.abort(new Error('Model connection was removed')); void this.descriptions.stop() }
    else {
      this.descriptions.start()
    }
  }

  view(podId: string | null = this.context, creationId?: string): MasterView {
    const conversations = new MasterConversations(this.store)
    const requested = creationId ? `creation:${creationId}` : podId ?? ''
    const scope = conversations.resolve(requested)
    const boundPodId = scope && !scope.startsWith('creation:') ? scope : null
    const session = scope === conversations.resolve(this.context) && this.active ? this.store.db.prepare('SELECT * FROM master_session WHERE id=1').get()! : conversations.session(scope)
    return { adoption: boundPodId ? new LegacyChatAdoption(this.store).preview(boundPodId) : null, ...(requested.startsWith('creation:') ? { creationId: requested.slice(9), boundPodId } : {}), description: boundPodId ? this.descriptions.view(boundPodId) : null, initialRequest: boundPodId ? conversations.initial(boundPodId) : null, ...(boundPodId ? { scriptState: this.control.setup().scriptState(boundPodId) } : {}), connected: !!this.provider, state: session.state as MasterView['state'], error: session.error as string | null,
      messages: conversations.messages(scope),
      drafts: this.store.db.prepare('SELECT d.*,p.name FROM script_drafts d JOIN pods p ON p.id=d.pod_id WHERE (?=\'\' OR d.pod_id=?) ORDER BY d.rowid DESC LIMIT 20').all(scope, scope).map(row => ({ id: row.id as string, podId: row.pod_id as string, name: row.name as string, revision: row.revision as number, code: row.code as string, capabilities: JSON.parse(row.capabilities as string) as string[], validation: row.validation as string | null, hash: row.script_hash as string | null })).filter(draft => !scope || draft.podId === scope),
      proposals: scope.startsWith('creation:') ? [] : this.control.setup().proposals(scope),
    }
  }

  async execute(command: MasterCommand): Promise<MasterView> {
    const conversations = new MasterConversations(this.store)
    if (command.type === 'answerSetup') { this.control.setup().answer(command); return this.view(command.podId) }
    if (command.type === 'resolveSetup') { await this.control.setup().resolve(command); return this.view(command.podId) }
    if (command.type === 'adopt') { new LegacyChatAdoption(this.store).adopt(command.podId, command.hash); this.descriptions.request(command.podId); this.descriptions.start(); return this.view(command.podId) }
    if (command.type === 'summarize') { this.descriptions.request(command.podId, true); this.descriptions.start(); return this.view(command.podId) }
    if (command.type === 'begin') { conversations.begin(command.id); return this.view(null, command.id) }
    if (command.type === 'list') return this.view(command.podId === undefined ? this.context : command.podId, command.creationId)
    const requestedScope = command.creationId ? `creation:${command.creationId}` : command.podId ?? ''
    const scope = conversations.resolve(requestedScope)
    const selectedPod = scope && !scope.startsWith('creation:') ? scope : null
    if (command.type === 'decline') { if (command.podId && this.store.db.prepare('SELECT pod_id FROM access_proposals WHERE id=?').get(command.id)?.pod_id !== command.podId) throw new Error('Access proposal belongs to another pod'); this.store.db.prepare('UPDATE access_proposals SET state=\'declined\' WHERE id=? AND state=\'pending\'').run(command.id); return this.view(command.podId === undefined ? this.context : command.podId) }
    if (command.type === 'cancel') { if (command.podId !== undefined && scope !== conversations.resolve(this.context)) throw new Error('Another pod owns the active chat'); await this.stop(); return this.view() }
    const context = selectedPod ? this.store.getPod(selectedPod) : null
    const text = `${command.text}\n\nSelected context: ${context ? JSON.stringify({ podId: context.id, revision: context.revision, name: context.name }) : 'workspace / new pod'}`
    const requestHash = digest(JSON.stringify(command))
    const prior = this.store.db.prepare('SELECT request_hash FROM master_inputs WHERE id=?').get(command.id)
    if (prior) { if (prior.request_hash !== requestHash) throw new Error('Message identity reused with different input'); return this.view(command.podId, command.creationId) }
    if (command.type === 'steer') {
      if (scope !== conversations.resolve(this.context)) throw new Error('Another pod owns the active chat')
      const session = this.store.db.prepare('SELECT * FROM master_session WHERE id=1').get()!
      if (!this.transport || !session.active_turn || !this.active) throw new Error('No active master turn to steer')
      this.input(command.id, command.text, requestHash, 'sending')
      try { await this.transport.request('turn/steer', { threadId: session.thread_id, expectedTurnId: session.active_turn, input: [{ type: 'text', text }] }); this.store.db.prepare('UPDATE master_messages SET state=\'sent\' WHERE id=?').run(command.id) }
      catch (error) { this.store.db.prepare('UPDATE master_messages SET state=\'uncertain\' WHERE id=?').run(command.id); throw error }
      return this.view()
    }
    if (this.active) throw new Error('The master is already running; steer or cancel this turn')
    this.context = requestedScope
    new MasterConversations(this.store).select(this.context)
    this.input(command.id, command.text, requestHash, 'sent')
    if (!this.provider) { this.store.db.prepare('UPDATE master_session SET state=\'failed\',error=\'Codex is not connected. Connect your account before sending another message.\' WHERE id=1').run(); new MasterConversations(this.store).capture(this.context); return this.view() }
    this.store.db.prepare('UPDATE master_session SET state=\'running\',error=NULL,active_turn=NULL WHERE id=1').run()
    this.controller = new AbortController(); this.actions = 0
    this.active = this.run(text, command.model ?? 'gpt-5.5').finally(() => { this.active = null; this.controller = null; this.descriptions.start() })
    new MasterConversations(this.store).capture(this.context)
    return this.view()
  }

  private async run(text: string, model: ChatModel): Promise<void> {
    const signal = this.controller!.signal; this.deadline = new MasterDeadline(error => this.controller?.abort(error))
    let completionError: Error | undefined
    let outcome: MasterView['state'] = 'idle'; let failure: string | null = null
    const finished = new Promise<void>((resolve) => { this.finish = (error) => { completionError = error; resolve() } })
    const abort = () => this.finish?.(signal.reason instanceof Error ? signal.reason : new Error('Master cancelled'))
    signal.addEventListener('abort', abort, { once: true })
    try {
      const root = join(this.store.root, 'master')
      await inspectDomainRecords(this.store.db.prepare('SELECT * FROM master_domains').all(), root, this.runtime.helper)
      this.store.db.prepare('DELETE FROM master_domains').run(); signal.throwIfAborted()
      this.transport = await MasterTransport.start(this.runtime, root, { provider: this.provider!, tool: async () => { throw new Error('Master has no MCP tools') } }, (path, ownerPid) => { this.store.db.prepare('INSERT INTO master_domains VALUES(?,?)').run(path, ownerPid) }, frame => this.notify(frame))
      const previous = this.store.db.prepare('SELECT thread_id FROM master_session WHERE id=1').get()!.thread_id as string | null
      const threadId = await this.transport.thread(this.runtime, root, previous, false, model); signal.throwIfAborted()
      this.store.db.prepare('UPDATE master_session SET thread_id=? WHERE id=1').run(threadId)
      new MasterConversations(this.store).capture(this.context)
      await this.transport.request('turn/start', { threadId, model, input: [{ type: 'text', text }] })
      await finished
      if (completionError) throw completionError
      signal.throwIfAborted()
    }
    catch (error) {
      outcome = signal.aborted ? 'interrupted' : 'failed'; failure = error instanceof Error ? error.message : 'Master failed'
    }
    finally {
      this.deadline?.close(); this.deadline = null; signal.removeEventListener('abort', abort); this.controller?.abort(new Error('Master turn ended'))
      await Promise.all(this.tools)
      try { await this.transport?.close() }
      catch (error) { outcome = 'failed'; failure = error instanceof Error ? error.message : 'Master cleanup failed' }
      this.transport = null; this.finish = null
      this.store.db.prepare('UPDATE master_session SET active_turn=NULL,state=?,error=? WHERE id=1').run(outcome, failure)
      const conversations = new MasterConversations(this.store)
      conversations.capture(this.context)
      const scope = conversations.resolve(this.context)
      if (outcome === 'idle' && scope && !scope.startsWith('creation:')) this.descriptions.request(scope)
      this.store.db.prepare('UPDATE master_messages SET state=\'interrupted\' WHERE state=\'streaming\'').run()
    }
  }

  private notify(frame: MasterFrame): void {
    if (frame.method === 'transport/failed') { this.finish?.(new Error(String(frame.params?.message))); return }
    const params = frame.params ?? {}; const session = this.store.db.prepare('SELECT * FROM master_session WHERE id=1').get()!
    if (frame.id !== undefined) {
      if (params.threadId === session.thread_id && params.turnId === session.active_turn) this.deadline?.progress()
      const task = this.tool(frame).catch((error: unknown) => this.finish?.(error instanceof Error ? error : new Error('Master tool response failed'))).finally(() => this.tools.delete(task))
      this.tools.add(task); return
    }
    if (params.threadId !== session.thread_id) return
    this.deadline?.progress()
    if (frame.method === 'turn/started') {
      const turn = params.turn as { id?: string }
      if (typeof turn?.id !== 'string') throw new Error('Invalid master turn identity')
      this.store.db.prepare('UPDATE master_session SET active_turn=? WHERE id=1').run(turn.id); return
    }
    if (frame.method === 'turn/completed') {
      const turn = params.turn as { id?: string, status?: string, error?: { message?: string } }
      if (turn.id !== session.active_turn) return
      this.finish?.(turn.status === 'completed' ? undefined : new Error(turn.error?.message ?? `Master turn ${turn.status}`)); return
    }
    if (params.turnId !== session.active_turn) return
    const id = `${session.thread_id as string}:${session.active_turn as string}:${String(params.itemId ?? (params.item as { id?: string })?.id)}`
    if (frame.method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
      const current = this.store.db.prepare('SELECT body FROM master_messages WHERE id=?').get(id)?.body as string | undefined
      this.message(id, 'assistant', (current ?? '') + params.delta, 'streaming')
    }
    if (frame.method === 'item/completed') {
      const item = params.item as { type?: string, text?: string }
      if (item?.type === 'agentMessage' && typeof item.text === 'string') this.message(id, 'assistant', item.text, 'completed')
    }
  }

  private async tool(frame: MasterFrame): Promise<void> {
    const params = frame.params ?? {}; const session = this.store.db.prepare('SELECT * FROM master_session WHERE id=1').get()!
    let text: string; let success = false
    const id = `${String(params.threadId)}:${String(params.turnId)}:${String(params.callId)}`
    try {
      if (frame.method !== 'item/tool/call' || params.tool !== 'pods_control' || params.threadId !== session.thread_id || params.turnId !== session.active_turn || typeof params.callId !== 'string' || params.callId.length > 128 || ++this.actions > 60) throw new Error('Master tool request is outside the active turn or allowed action budget')
      const result = await this.control.execute(id, params.arguments, this.controller!.signal, this.context.startsWith('creation:') ? null : this.context || null, this.context.startsWith('creation:') ? this.context.slice(9) : null)
      text = JSON.stringify(result); if (Buffer.byteLength(text) > 256 * 1024) throw new Error('Action completed but its result is too large; inspect a smaller portion in the workspace')
      success = true
    }
    catch (error) { text = JSON.stringify({ error: error instanceof Error ? error.message : 'Master action failed' }) }
    this.message(`tool:${id}`, 'tool', JSON.stringify({ request: params.arguments, result: JSON.parse(text) as unknown }), success ? 'completed' : 'failed')
    this.transport!.reply(frame.id!, { contentItems: [{ type: 'inputText', text }], success })
  }

  private input(id: string, text: string, hash: string, state: string): void {
    this.store.transaction(() => { this.message(id, 'user', text, state); this.store.db.prepare('INSERT INTO master_inputs VALUES(?,?)').run(id, hash) })
  }

  private message(id: string, role: 'user' | 'assistant' | 'tool', text: string, state: string): void {
    if (Buffer.byteLength(text) > 512 * 1024) throw new Error('Master message exceeds its limit')
    this.store.db.prepare('INSERT INTO master_messages VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,state=excluded.state').run(id, role, text, state, Date.now())
    new MasterConversations(this.store).assign(id, this.context)
  }

  async stop(): Promise<void> { this.controller?.abort(new Error('Master cancelled')); await this.active; await this.descriptions.stop() }
}
