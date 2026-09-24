import { administrationActions } from './codex-admin'
import { masterTool } from './master'

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
  description: 'Administer OpenApe Pods as the connected local owner. Call runtime for the script API and CLI setup help, then list and select before inspecting or changing Pods. Changes apply directly; Codex governs any tool confirmation. Preserve revision and resource checks. Secret values must never be supplied in arguments or returned. Legacy changes are history, not an approval queue.',
  inputSchema: {
    ...masterTool.inputSchema,
    properties: {
      ...masterTool.inputSchema.properties,
      action: { type: 'string', enum: [...masterTool.inputSchema.properties.action.enum.filter(action => action !== 'requestAccess'), 'select', 'changes', 'retireChange', 'setSchedule', ...administrationActions] },
      id: { type: 'string', description: 'retireChange: legacy change ID; revision must match changes receipt. Select every affected Pod.' },
      packages: { type: 'object', description: 'Exact npm dependency versions; prepare through scripts prepareDependencies before validation.' },
      command: { type: 'object', description: 'description: list/describe(text,revision). setup: resolveSetup(id,podId,resourceId,epoch,request) or decline(id,podId) for old proposals only. resources: list/assignHttp(permission)/assignDirectory(path,access)/assignReference(name,path)/revoke(id,revision)/removeVariable(name,revision). scripts: list/prepareDependencies. Assigned Pod secrets need no script declaration or approval. recovery: list/recover/resolveHttp/retryQueue/cancel. program: add/replace/network/grant/importState/prepare(line). prepare only resolves command metadata; runtime has the complete CLI setup sequence. All commands include podId and relevant epoch/revisions. importSecret: {podId,alias,epoch}; use path outside command. Outer revision is the current Pod revision.' },
      path: { type: 'string', description: 'importSecret: private owner file, never its content. program add/replace/importState: absolute source path.' },
      adapterPath: { type: 'string', description: 'program add/replace: optional Shapes adapter path.' },
      runtimePath: { type: 'string', description: 'program add/replace: optional owner-controlled JSON runtime descriptor (interpreter, fixed arguments, read-only package directories, non-secret environment). See runtime help.' },
      commandName: { type: 'string', description: 'program add/replace: optional CLI name.' },
      enabled: { type: 'boolean', description: 'setSchedule: enable or disable this schedule; resume separately after script validation.' },
      definition: { type: 'object', description: 'Selected workflow save command: type save, id, revision, name, nodes, schedule, enabled. All members must be selected.' },
      podIds: { type: 'array', items: { type: 'string' }, maxItems: 32, description: 'select: exact Pod UUIDs from list; replaces the current selection.' },
      workflowId: { type: ['string', 'null'], description: 'select: optional workflow UUID from list.' },
      workflowRevision: { type: ['integer', 'null'], description: 'select: current revision of that workflow.' },
    },
  },
}

// The owner's Codex registration as App settings shows it. `edited` means the
// owner changed the entry the app wrote, so removal is left to them (`manual`).
export interface CodexConnection { state: 'connected' | 'disconnected' | 'foreign' | 'edited', home: string, manual: string }
export interface CodexCommand { type: 'status' | 'connect' | 'disconnect' }
export function parseCodexCommand(value: unknown): CodexCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !['status', 'connect', 'disconnect'].includes((value as { type?: string }).type ?? '')) throw new Error('Invalid Codex command')
  return { type: (value as CodexCommand).type }
}
export function parseCodexConnection(value: unknown): CodexConnection {
  const item = value as CodexConnection
  if (!item || !['connected', 'disconnected', 'foreign', 'edited'].includes(item.state) || typeof item.home !== 'string' || typeof item.manual !== 'string') throw new Error('Invalid Codex connection')
  return { state: item.state, home: item.home, manual: item.manual }
}
