import type { WorkflowDefinition } from './workflows'

export interface ChatContext {
  podIds: string[]
  pods: { id: string, name: string }[]
  workflow: WorkflowDefinition | null
}
export interface Conversation {
  id: string
  title: string
  scope: string
  revision: number
  originPodId: string | null
  updatedAt: number
  context: ChatContext
  workflowChanged: boolean
  unavailablePodIds: string[]
  relatedWorkflowIds: string[]
  relatedPodIds: string[]
}
export interface ChatsView { conversations: Conversation[], activeConversationId: string | null }
export type ChatsCommand =
  | { type: 'list' }
  | { type: 'create', id: string, title: string, podIds: string[], workflowId: string | null, workflowRevision: number | null }
  | { type: 'rename', id: string, revision: number, title: string }
  | { type: 'context', id: string, revision: number, podIds: string[], workflowId: string | null, workflowRevision: number | null }

export function chatId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new Error('Invalid conversation identity')
}
export function parseChatsCommand(value: unknown): ChatsCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid conversation command')
  const item = value as Record<string, unknown>
  const fields = item.type === 'list' ? ['type'] : item.type === 'rename' ? ['type', 'id', 'revision', 'title'] : item.type === 'create' ? ['type', 'id', 'title', 'podIds', 'workflowId', 'workflowRevision'] : item.type === 'context' ? ['type', 'id', 'revision', 'podIds', 'workflowId', 'workflowRevision'] : []
  if (!fields.length || fields.some(field => !(field in item)) || Object.keys(item).some(field => !fields.includes(field))) throw new Error('Invalid conversation command fields')
  if (item.type === 'list') return { type: 'list' }
  chatId(item.id)
  if ('revision' in item && (!Number.isSafeInteger(item.revision) || Number(item.revision) < 1)) throw new Error('Invalid conversation revision')
  if ('title' in item && (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 100)) throw new Error('Conversation title must contain 1–100 characters')
  if ('podIds' in item) {
    if (!Array.isArray(item.podIds) || item.podIds.length > 32 || new Set(item.podIds).size !== item.podIds.length) throw new Error('Select at most 32 distinct Pods')
    item.podIds.forEach(chatId)
    if (item.workflowId !== null) chatId(item.workflowId)
    if (item.workflowId === null ? item.workflowRevision !== null : !Number.isSafeInteger(item.workflowRevision) || Number(item.workflowRevision) < 1) throw new Error('Invalid workflow context revision')
  }
  return structuredClone(item) as ChatsCommand
}
export function parseChatsView(value: unknown): ChatsView {
  if (!value || typeof value !== 'object') throw new Error('Invalid conversations view')
  const view = value as ChatsView
  if (!Array.isArray(view.conversations) || view.conversations.length > 1000) throw new Error('Invalid conversations list')
  if (view.activeConversationId !== null) chatId(view.activeConversationId)
  for (const conversation of view.conversations) {
    chatId(conversation.id)
    if (typeof conversation.title !== 'string' || typeof conversation.scope !== 'string' || !Number.isSafeInteger(conversation.revision) || !conversation.context || !Array.isArray(conversation.context.pods) || !Array.isArray(conversation.context.podIds) || !Array.isArray(conversation.relatedPodIds) || !Array.isArray(conversation.unavailablePodIds)) throw new Error('Invalid conversation fields')
  }
  return view
}
