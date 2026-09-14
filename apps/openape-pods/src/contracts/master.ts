import { parseScriptCapabilities } from './credentials'

export interface MasterMessage { id: string, role: 'user' | 'assistant' | 'tool', text: string, state: string, at: number }
export interface MasterDraft { id: string, podId: string, name: string, revision: number, code: string, capabilities: string[], validation: string | null, hash: string | null }
export interface AccessProposal { id: string, podId: string, body: Record<string, unknown>, state: 'pending' | 'declined' | 'approved' }
export interface MasterView { connected: boolean, state: 'idle' | 'running' | 'interrupted' | 'failed', error: string | null, messages: MasterMessage[], drafts: MasterDraft[], proposals: AccessProposal[] }
export type MasterCommand = { type: 'list', podId?: string | null } | { type: 'send' | 'steer', id: string, text: string, podId: string | null } | { type: 'cancel', podId?: string | null } | { type: 'decline', id: string, podId?: string | null }
export function parseMasterCommand(value: unknown): MasterCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid master request')
  const item = value as Record<string, unknown>
  const fields = item.type === 'list' || item.type === 'cancel' ? ['type', 'podId'] : item.type === 'decline' ? ['type', 'id', 'podId'] : item.type === 'send' || item.type === 'steer' ? ['type', 'id', 'text', 'podId'] : []
  if (!fields.length || Object.keys(item).some(key => !fields.includes(key))) throw new Error('Unsupported master request')
  if (item.podId !== undefined && item.podId !== null && (typeof item.podId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.podId))) throw new Error('Invalid chat pod context')
  if (fields.includes('id') && (typeof item.id !== 'string' || !/^[a-f0-9-]{36}$/.test(item.id))) throw new Error('Invalid master request identity')
  if (fields.includes('text') && (typeof item.text !== 'string' || !item.text.trim() || item.text.length > 20000 || (item.podId !== null && (typeof item.podId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.podId))))) throw new Error('Invalid master input')
  return structuredClone(item) as MasterCommand
}
export function parseMasterView(value: unknown): MasterView {
  if (!value || typeof value !== 'object') throw new Error('Invalid master state')
  const view = value as MasterView
  if (typeof view.connected !== 'boolean' || !['idle', 'running', 'interrupted', 'failed'].includes(view.state) || (view.error !== null && typeof view.error !== 'string') || !Array.isArray(view.messages) || view.messages.length > 100 || !Array.isArray(view.drafts) || view.drafts.length > 20 || !Array.isArray(view.proposals) || view.proposals.length > 100) throw new Error('Invalid master state fields')
  for (const message of view.messages) {
    if (!message || typeof message.id !== 'string' || typeof message.text !== 'string' || !['user', 'assistant', 'tool'].includes(message.role) || typeof message.state !== 'string' || !Number.isSafeInteger(message.at)) throw new Error('Invalid master message')
  }
  for (const draft of view.drafts) {
    if (!draft || typeof draft.id !== 'string' || typeof draft.code !== 'string' || !Number.isSafeInteger(draft.revision) || !Array.isArray(draft.capabilities)) throw new Error('Invalid master draft')
  }
  for (const proposal of view.proposals) {
    if (!proposal || typeof proposal.id !== 'string' || typeof proposal.podId !== 'string' || !['pending', 'declined', 'approved'].includes(proposal.state)) throw new Error('Invalid access proposal')
    parseMasterAction({ action: 'requestAccess', podId: proposal.podId, revision: 1, request: proposal.body })
  }
  return view
}
export type MasterAction =
  | { action: 'list' }
  | { action: 'create', name: string, assignment: string }
  | { action: 'inspect' | 'run' | 'pause' | 'resume' | 'installMailRecipe', podId: string, revision: number }
  | { action: 'revise', podId: string, revision: number, name: string, assignment: string }
  | { action: 'draft', podId: string, revision: number, draftId: string | null, draftRevision: number, code: string, capabilities: string[] }
  | { action: 'validate' | 'activate', podId: string, revision: number, draftId: string, draftRevision: number }
  | { action: 'rollback', podId: string, revision: number, hash: string, expectedActive: string | null }
  | { action: 'requestAccess', podId: string, revision: number, request: { provider: 'application' | 'http' | 'microsoft' | 'reference', application?: string, command?: string, origin?: string, account?: string, folders?: string[], attachments?: boolean, description: string } }
export function parseMasterAction(value: unknown): MasterAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid master action')
  const item = value as Record<string, unknown>
  const extra: Record<string, string[]> = { list: [], create: ['name', 'assignment'], inspect: [], run: [], pause: [], resume: [], installMailRecipe: [], revise: ['name', 'assignment'], draft: ['draftId', 'draftRevision', 'code', 'capabilities'], validate: ['draftId', 'draftRevision'], activate: ['draftId', 'draftRevision'], rollback: ['hash', 'expectedActive'], requestAccess: ['request'] }
  if (typeof item.action !== 'string' || !Object.hasOwn(extra, item.action)) throw new Error('Master action is not allowed')
  const scoped = !['list', 'create'].includes(item.action)
  const allowed = ['action', ...(scoped ? ['podId', 'revision'] : []), ...extra[item.action]]
  if (Object.keys(item).some(key => !allowed.includes(key)) || allowed.some(key => !(key in item))) throw new Error('Invalid master action fields')
  if (scoped && (typeof item.podId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.podId) || !Number.isSafeInteger(item.revision) || (item.revision as number) < 1)) throw new Error('Invalid master pod revision')
  if (allowed.includes('assignment') && (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100 || typeof item.assignment !== 'string' || !item.assignment.trim() || item.assignment.length > 20000)) throw new Error('Invalid pod assignment')
  if (allowed.includes('draftId') && ((item.action !== 'draft' || item.draftId !== null) && (typeof item.draftId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.draftId)))) throw new Error('Invalid draft identity')
  if (allowed.includes('draftRevision') && (!Number.isSafeInteger(item.draftRevision) || (item.draftRevision as number) < (item.action === 'draft' && item.draftId === null ? 0 : 1))) throw new Error('Invalid draft revision')
  if (item.action === 'draft' && (typeof item.code !== 'string' || !item.code.trim() || item.code.length > 150000)) throw new Error('Invalid draft contract')
  if (item.action === 'draft') parseScriptCapabilities(item.capabilities)
  if (item.action === 'rollback' && (typeof item.hash !== 'string' || !/^[a-f0-9]{64}$/.test(item.hash) || (item.expectedActive !== null && (typeof item.expectedActive !== 'string' || !/^[a-f0-9]{64}$/.test(item.expectedActive))))) throw new Error('Invalid rollback version')
  if (item.action === 'requestAccess') {
    const request = item.request as Record<string, unknown>
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key => !['provider', 'application', 'command', 'origin', 'account', 'folders', 'attachments', 'description'].includes(key)) || !['application', 'http', 'microsoft', 'reference'].includes(request.provider as string) || typeof request.description !== 'string' || !request.description.trim() || request.description.length > 4000 || (request.account !== undefined && (typeof request.account !== 'string' || request.account.length > 254)) || (request.folders !== undefined && (!Array.isArray(request.folders) || request.folders.length > 100 || request.folders.some(folder => typeof folder !== 'string' || !folder || folder.length > 2048))) || (request.attachments !== undefined && typeof request.attachments !== 'boolean')) throw new Error('Invalid resource proposal')
    if (['application', 'command', 'origin'].some(key => request[key] !== undefined && (typeof request[key] !== 'string' || String(request[key]).length > 4000))) throw new Error('Invalid resource proposal')
  }
  return structuredClone(item) as MasterAction
}
export const masterTool = { type: 'function', name: 'pods_control', description: 'Manage local pods within their current assignment and permissions. Allowed actions: list; create(name,assignment); inspect/run/pause/resume/installMailRecipe(podId,revision); revise(podId,revision,name,assignment); draft(podId,revision,draftId|null,draftRevision,code,capabilities); validate/activate(podId,revision,draftId,draftRevision); rollback(podId,revision,hash,expectedActive); requestAccess(podId,revision,request). All mutations require current revisions. New pods are manual-only. Resource proposals require owner review; this tool cannot approve permissions or enable schedules. Drafts export async run(context). Use context.variables for named working values, context.credentials.get(alias) for secrets, context.tools.invoke({applicationId,argv}) for assigned program reads, context.http.request({url,method,headers,body,key}) for explicit HTTPS destinations, context.agent.run({prompt}) for AI, and context.progress.commit for checkpoints. HTTP returns {status,headers,body}; mutating methods require a stable operation key and uncertain delivery blocks retries. Copy exact tool.* capabilities from inspected resources plus credential.<alias> (16 total). Global connections are only ChatGPT and OpenApe. For other programs, requestAccess with provider application, application name, command arguments and description; for network destinations use provider http, origin and description. Program authentication is configured in the owner terminal under Permissions; never infer a generic login status. Existing auth files may be imported into protected application state, never reference snapshots. Tool tokens stay outside script and model contexts; do not ask for them in chat. Use the existing mail helper only for legacy pods. Read assigned named values with await context.credentials.get(alias); values never belong in prompts or logs unless explicitly intended by the owner. The owner must approve the exact validated credential-reading version in Settings before activation; this tool cannot grant that approval. Validation executes with synthetic services only; activation never expands permissions.', inputSchema: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'], additionalProperties: true } }
