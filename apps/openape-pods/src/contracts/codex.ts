import { masterTool } from './master'

// Requests from the owner's locally installed Codex (issue 1375). They carry one
// pods_control action. Applying, discarding, approving and starting runs have no
// representation here: those stay owner actions inside the app.
export const codexConversationId = '00000000-0000-4000-8000-00000000c0de'
export interface CodexRequest { id: string, action: Record<string, unknown> }

export function parseCodexRequest(value: unknown): CodexRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Codex request')
  const item = value as Record<string, unknown>
  if (Object.keys(item).some(key => key !== 'id' && key !== 'action') || typeof item.id !== 'string' || !/^[a-f0-9-]{36}$/.test(item.id)) throw new Error('Invalid Codex request')
  if (!item.action || typeof item.action !== 'object' || Array.isArray(item.action)) throw new Error('Invalid Codex action')
  return { id: item.id, action: structuredClone(item.action) as Record<string, unknown> }
}

export const codexTool = {
  name: masterTool.name,
  description: `${masterTool.description} Call select with podIds (and optionally a workflow) before inspecting or changing Pods; changes lists prepared reviews and their state. The owner applies changes and starts runs in OpenApe Pods under Prepared by Codex.`,
  inputSchema: {
    ...masterTool.inputSchema,
    properties: {
      ...masterTool.inputSchema.properties,
      action: { type: 'string', enum: [...masterTool.inputSchema.properties.action.enum, 'select', 'changes'] },
      podIds: { type: 'array', items: { type: 'string' }, maxItems: 32, description: 'select: exact Pod UUIDs from list; replaces the current selection.' },
      workflowId: { type: ['string', 'null'], description: 'select: optional workflow UUID from list.' },
      workflowRevision: { type: ['integer', 'null'], description: 'select: current revision of that workflow.' },
    },
  },
}
