import { parseWorkflowCommand } from './workflows'
import type { WorkflowCommand } from './workflows'
import type { ChangeSet } from './control-api'
import { chatId } from './chats'
import type { Conversation } from './chats'
import { parseChatModel } from './models'
import type { ChatModel } from './models'
import { parseSetupRequest } from './setup'
import type { SetupRequest } from './setup'
import { parsePackages } from './dependencies'
import type { PackageManifest } from './dependencies'
import type { AdoptionPreview, PodDescription  } from './description'
import { parseScriptCapabilities } from './credentials'
import { parseVariable } from './resources'
import { groupName } from './groups'
import { parseSchedule } from './scheduling'
import type { ScheduleSpec } from './scheduling'

export interface MasterMessage { sequence?: number, contextRevision?: number, id: string, role: 'user' | 'assistant' | 'tool', text: string, state: string, at: number }
export interface MasterDraft { validationError?: string | null, id: string, podId: string, name: string, revision: number, code: string, capabilities: string[], validation: string | null, hash: string | null }
export interface AccessProposal { id: string, podId: string, body: SetupRequest, state: 'pending' | 'declined' | 'approved' }
export interface MasterView { changes?: ChangeSet[], conversation?: Conversation, nextBefore?: number | null, activeConversationId?: string | null, scriptState?: 'missing' | 'draft' | 'active', adoption?: AdoptionPreview | null, description?: PodDescription | null, creationId?: string, boundPodId?: string | null, initialRequest?: MasterMessage | null, connected: boolean, state: 'idle' | 'running' | 'interrupted' | 'failed', error: string | null, messages: MasterMessage[], drafts: MasterDraft[], proposals: AccessProposal[] }
export type MasterCommand = ({ type: 'applyChanges', id: string, revision: number } | { type: 'discardChanges', id: string, revision: number } | { type: 'resolveSetup', id: string, podId: string, resourceId: string, epoch: number, request: SetupRequest } | { type: 'answerSetup', id: string, podId: string, value: string, revision: number } | { type: 'adopt', podId: string, hash: string } | { type: 'summarize', podId: string } | { type: 'begin', id: string } | { type: 'list', podId?: string | null } | { type: 'send' | 'steer', id: string, text: string, podId: string | null, model?: ChatModel } | { type: 'cancel', podId?: string | null } | { type: 'decline', id: string, podId?: string | null }) & { creationId?: string, conversationId?: string, contextRevision?: number, before?: number }
export function parseMasterCommand(value: unknown): MasterCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid master request')
  const item = value as Record<string, unknown>
  const fields = item.type === 'applyChanges' || item.type === 'discardChanges' ? ['type', 'id', 'revision'] : item.type === 'resolveSetup' ? ['type', 'id', 'podId', 'resourceId', 'epoch', 'request'] : item.type === 'answerSetup' ? ['type', 'id', 'podId', 'value', 'revision'] : item.type === 'adopt' ? ['type', 'podId', 'hash'] : item.type === 'summarize' ? ['type', 'podId'] : item.type === 'begin' ? ['type', 'id'] : item.type === 'list' || item.type === 'cancel' ? ['type', 'podId'] : item.type === 'decline' ? ['type', 'id', 'podId'] : item.type === 'send' || item.type === 'steer' ? ['type', 'id', 'text', 'podId', 'model'] : []
  if (!fields.length || Object.keys(item).some(key => !fields.includes(key) && !['creationId', 'conversationId', 'contextRevision', 'before'].includes(key))) throw new Error('Unsupported master request')
  if (['summarize', 'adopt'].includes(item.type as string) && (typeof item.podId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.podId))) throw new Error('Invalid description pod')
  if (item.type === 'adopt' && (typeof item.hash !== 'string' || !/^[a-f0-9]{64}$/.test(item.hash))) throw new Error('Invalid history review hash')
  if (['applyChanges', 'discardChanges'].includes(item.type as string) && (typeof item.conversationId !== 'string' || !Number.isSafeInteger(item.revision) || Number(item.revision) < 1)) throw new Error('Current change review required')
  if (item.creationId !== undefined && (typeof item.creationId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.creationId) || item.podId)) throw new Error('Invalid creation conversation')
  if (item.conversationId !== undefined) {
    chatId(item.conversationId)
    if (item.creationId !== undefined) throw new Error('Choose a conversation or creation scope')
    if (item.type !== 'list' && (!Number.isSafeInteger(item.contextRevision) || Number(item.contextRevision) < 1)) throw new Error('Current conversation context revision required')
  }
  else if (item.contextRevision !== undefined) {
    throw new Error('Conversation identity required')
  }
  if (item.before !== undefined && (item.type !== 'list' || !Number.isSafeInteger(item.before) || Number(item.before) < 1)) throw new Error('Invalid history cursor')
  if (item.podId !== undefined && item.podId !== null && (typeof item.podId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.podId))) throw new Error('Invalid chat pod context')
  if (fields.includes('id') && (typeof item.id !== 'string' || !/^[a-f0-9-]{36}$/.test(item.id))) throw new Error('Invalid master request identity')
  if (fields.includes('text') && (typeof item.text !== 'string' || !item.text.trim() || item.text.length > 20000 || (item.podId !== null && (typeof item.podId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.podId))))) throw new Error('Invalid master input')
  if (item.type === 'resolveSetup' || item.type === 'answerSetup') {
    if (typeof item.podId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.podId) || item.creationId !== undefined) throw new Error('Invalid setup pod')
    if (item.type === 'resolveSetup') {
      if (typeof item.resourceId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.resourceId) || !Number.isSafeInteger(item.epoch) || Number(item.epoch) < 0) throw new Error('Invalid setup resource')
      item.request = parseSetupRequest(item.request)
    }
    else {
      parseVariable({ name: 'answer', value: item.value as string, revision: item.revision as number })
    }
  }
  if (item.model !== undefined) parseChatModel(item.model)
  return structuredClone(item) as MasterCommand
}
export function parseMasterView(value: unknown): MasterView {
  if (!value || typeof value !== 'object') throw new Error('Invalid master state')
  const view = value as MasterView
  if (typeof view.connected !== 'boolean' || !['idle', 'running', 'interrupted', 'failed'].includes(view.state) || (view.error !== null && typeof view.error !== 'string') || !Array.isArray(view.messages) || view.messages.length > 100 || !Array.isArray(view.drafts) || view.drafts.length > 20 || !Array.isArray(view.proposals) || view.proposals.length > 100) throw new Error('Invalid master state fields')
  if (view.creationId !== undefined && !/^[a-f0-9-]{36}$/.test(view.creationId)) throw new Error('Invalid creation view')
  if (view.boundPodId !== undefined && view.boundPodId !== null && !/^[a-f0-9-]{36}$/.test(view.boundPodId)) throw new Error('Invalid bound pod')
  if (view.initialRequest && (view.initialRequest.role !== 'user' || typeof view.initialRequest.text !== 'string' || !Number.isSafeInteger(view.initialRequest.at))) throw new Error('Invalid initial request')
  if (view.description && (typeof view.description.text !== 'string' || view.description.text.length > 4000 || !['pending', 'running', 'ready', 'failed'].includes(view.description.state) || !Number.isSafeInteger(view.description.revision))) throw new Error('Invalid description view')
  if (view.adoption && (!/^[a-f0-9]{64}$/.test(view.adoption.hash) || !Array.isArray(view.adoption.requests) || view.adoption.requests.some(request => typeof request.id !== 'string' || typeof request.text !== 'string'))) throw new Error('Invalid history recovery view')
  if (view.scriptState !== undefined && !['missing', 'draft', 'active'].includes(view.scriptState)) throw new Error('Invalid setup script state')
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
  | { action: 'inspectWorkflow' | 'runWorkflow' }
  | { action: 'saveWorkflow', definition: Extract<WorkflowCommand, { type: 'save' }> }
  | { action: 'list' }
  | { action: 'runtime' }
  | { action: 'create', name: string }
  | { action: 'inspect' | 'run' | 'pause' | 'resume' | 'installMailRecipe', podId: string, revision: number }
  | { action: 'setVariable', podId: string, revision: number, name: string, value: string, variableRevision: number }
  | { action: 'setSchedule', podId: string, revision: number, spec: ScheduleSpec, scheduleRevision: number, enabled: boolean }
  | { action: 'prepareSchedule', podId: string, revision: number, spec: ScheduleSpec, scheduleRevision: number }
  | { action: 'setGroup', podId: string, revision: number, name: string | null, organizationRevision: number }
  | { action: 'revise', podId: string, revision: number, name: string }
  | { action: 'draft', podId: string, revision: number, draftId: string | null, draftRevision: number, code: string, capabilities: string[], packages?: PackageManifest }
  | { action: 'validate' | 'activate', podId: string, revision: number, draftId: string, draftRevision: number }
  | { action: 'rollback', podId: string, revision: number, hash: string, expectedActive: string | null }
  | { action: 'requestAccess', podId: string, revision: number, request: SetupRequest }
export function parseMasterAction(value: unknown): MasterAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid master action')
  const item = { ...value } as Record<string, unknown>
  if (['inspectWorkflow', 'runWorkflow', 'saveWorkflow'].includes(String(item.action))) {
    const allowed = item.action === 'saveWorkflow' ? ['action', 'definition'] : ['action']
    if (Object.keys(item).some(key => !allowed.includes(key))) throw new Error('Invalid workflow action fields')
    if (item.action === 'saveWorkflow') {
      const definition = parseWorkflowCommand(item.definition)
      if (definition.type !== 'save') throw new Error('Workflow save definition required')
      return { action: 'saveWorkflow', definition }
    }
    return { action: item.action as 'inspectWorkflow' | 'runWorkflow' }
  }
  const extra: Record<string, string[]> = { list: [], runtime: [], setVariable: ['name', 'value', 'variableRevision'], prepareSchedule: ['spec', 'scheduleRevision'], setSchedule: ['spec', 'scheduleRevision', 'enabled'], setGroup: ['name', 'organizationRevision'], create: ['name'], inspect: [], run: [], pause: [], resume: [], installMailRecipe: [], revise: ['name'], draft: ['draftId', 'draftRevision', 'code', 'capabilities'], validate: ['draftId', 'draftRevision'], activate: ['draftId', 'draftRevision'], rollback: ['hash', 'expectedActive'], requestAccess: ['request'] }
  if (typeof item.action !== 'string' || !Object.hasOwn(extra, item.action)) throw new Error('Master action is not allowed')
  const scoped = !['list', 'runtime', 'create'].includes(item.action)
  const allowed = ['action', ...(scoped ? ['podId', 'revision'] : []), ...extra[item.action]]
  if (Object.keys(item).some(key => !allowed.includes(key) && !(item.action === 'draft' && key === 'packages')) || allowed.some(key => !(key in item))) throw new Error('Invalid master action fields')
  if (scoped && (typeof item.podId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.podId) || !Number.isSafeInteger(item.revision) || (item.revision as number) < 1)) throw new Error('Invalid master pod revision')
  if (['create', 'revise'].includes(item.action) && (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100)) throw new Error('Invalid pod name')
  if (allowed.includes('draftId') && ((item.action !== 'draft' || item.draftId !== null) && (typeof item.draftId !== 'string' || !/^[a-f0-9-]{36}$/.test(item.draftId)))) throw new Error('Invalid draft identity')
  if (allowed.includes('draftRevision') && (!Number.isSafeInteger(item.draftRevision) || (item.draftRevision as number) < (item.action === 'draft' && item.draftId === null ? 0 : 1))) throw new Error('Invalid draft revision')
  if (item.action === 'draft' && (typeof item.code !== 'string' || !item.code.trim() || item.code.length > 150000)) throw new Error('Invalid draft contract')
  if (item.action === 'draft') { parseScriptCapabilities(item.capabilities); if (item.packages !== undefined) item.packages = parsePackages(item.packages) }
  if (item.action === 'setVariable') {
    if (typeof item.name !== 'string' || typeof item.value !== 'string' || typeof item.variableRevision !== 'number') throw new Error('Invalid pod variable')
    parseVariable({ name: item.name, value: item.value, revision: item.variableRevision })
  }
  if (item.action === 'setSchedule' && typeof item.enabled !== 'boolean') throw new Error('Schedule enabled state required')
  if (item.action === 'prepareSchedule' || item.action === 'setSchedule') { parseSchedule(item.spec); if (!Number.isSafeInteger(item.scheduleRevision) || (item.scheduleRevision as number) < 0) throw new Error('Invalid schedule revision') }
  if (item.action === 'setGroup') { if (item.name !== null) item.name = groupName(item.name); if (!Number.isSafeInteger(item.organizationRevision) || (item.organizationRevision as number) < 1) throw new Error('Invalid organization revision') }
  if (item.action === 'rollback' && (typeof item.hash !== 'string' || !/^[a-f0-9]{64}$/.test(item.hash) || (item.expectedActive !== null && (typeof item.expectedActive !== 'string' || !/^[a-f0-9]{64}$/.test(item.expectedActive))))) throw new Error('Invalid rollback version')
  if (item.action === 'requestAccess') item.request = parseSetupRequest(item.request)
  return structuredClone(item) as MasterAction
}
export const masterTool = {
  type: 'function', name: 'pods_control',
  description: 'Configure OpenApe Pods using revision-checked actions. First call runtime for the script API and action formats, then list/inspect for current IDs and revisions. Only explicit conversation context may be inspected or changed. activate/configuration actions prepare a change set awaiting owner review. run prepares an explicit Run once request. The owner applies or runs through the review UI; the model cannot approve its own work. New pods and prepared schedules remain paused. Ordinary variables are model-visible; secret values must never be supplied in tool arguments or chat. requestAccess creates an owner-reviewed proposal, never a permission or credential approval. Validate, repair failures and activate only with the current script and permissions. Synthetic validation does not prove live provider behavior. Do not run without a user request.',
  inputSchema: {
    type: 'object', required: ['action'], additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['inspectWorkflow', 'saveWorkflow', 'runWorkflow', 'runtime', 'list', 'create', 'inspect', 'revise', 'setVariable', 'prepareSchedule', 'setGroup', 'draft', 'validate', 'activate', 'run', 'pause', 'resume', 'rollback', 'requestAccess', 'installMailRecipe'] },
      definition: { type: 'object', description: 'Existing selected workflow save command: type save, id, revision, name, nodes, schedule, enabled. Preserve enabled/paused schedules; added members must already be explicitly selected. Owner reviews before apply.' },
      podId: { type: 'string', description: 'Exact pod UUID from list/create.' }, revision: { type: 'integer', minimum: 1, description: 'Current pod settings revision.' },
      name: { type: ['string', 'null'], description: 'Pod/variable/group name; null only removes group membership.' },
      value: { type: 'string', description: 'Ordinary, non-secret variable value only.' }, variableRevision: { type: 'integer', minimum: 0 },
      spec: { type: 'object', description: 'Interval {kind:"interval",seconds:60..2592000} or daily {kind:"daily",time:"HH:MM",timezone:"Europe/Vienna"}.' }, scheduleRevision: { type: 'integer', minimum: 0 },
      organizationRevision: { type: 'integer', minimum: 1 },
      draftId: { type: ['string', 'null'] }, draftRevision: { type: 'integer', minimum: 0 }, code: { type: 'string' }, capabilities: { type: 'array', items: { type: 'string' }, maxItems: 16 },
      packages: { type: 'object', description: 'Optional package.json containing only dependencies with exact npm versions; owner prepares new sets in Script.' },
      hash: { type: 'string' }, expectedActive: { type: ['string', 'null'] },
      request: { type: 'object', description: 'Owner setup proposal: provider (application/http/directory/reference/credential/variable), description and instructions. HTTP: origin and methods. Directory: path and access (read/readWrite). Application: application, argv and networkHosts. Credential/variable: alias, never a secret value. Variable proposals ask for missing ordinary configuration.' },
    },
  },
}
