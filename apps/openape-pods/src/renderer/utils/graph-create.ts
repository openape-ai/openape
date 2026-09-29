import type { GraphChannel, GraphContract } from '../../contracts/graphs'
import type { WorkflowCommand, WorkflowDefinition, WorkflowSchedule } from '../../contracts/workflows'

export type GraphSchedule = 'manual' | 'hourly' | 'daily'
export type CreateRequest
  = | { kind: 'graph', name: string, groupId: string | null, schedule: GraphSchedule, time: string, podIds: string[] }
    | { kind: 'pod', name: string, summary: string, groupId: string | null, graphId: string | null, takes: string[], gives: string[] }
    | { kind: 'group', name: string }
type Save = Extract<WorkflowCommand, { type: 'save' }>

/** Channel names as typed by hand: separated by commas or spaces, without repeats. */
export function channelNames(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map(name => name.trim()).filter(Boolean))]
}
function schedule(kind: GraphSchedule, time: string): WorkflowSchedule | null {
  if (kind === 'hourly') return { kind: 'interval', seconds: 3600 }
  return kind === 'daily' ? { kind: 'daily', time, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : null
}
/** Every channel a contract names is declared once; a channel that is already declared keeps its title and fields. */
export function declaredChannels(existing: GraphChannel[], contracts: (GraphContract | null | undefined)[]): GraphChannel[] {
  const names = contracts.flatMap(contract => contract ? [...contract.takes, ...contract.gives] : [])
  return [...existing, ...[...new Set(names)].filter(name => !existing.some(channel => channel.name === name)).map(name => ({ name, title: name, fields: [] }))]
}
/** A new graph starts disabled, even with a schedule: the owner enables it after the first review. */
export function newGraph(id: string, request: Extract<CreateRequest, { kind: 'graph' }>, contracts: Record<string, GraphContract | null>): Save {
  return { type: 'save', id, revision: 0, name: request.name.trim(), nodes: request.podIds.map(podId => ({ podId, after: [], handoff: false })), schedule: schedule(request.schedule, request.time), enabled: false, mode: 'channels', groupId: request.groupId, channels: declaredChannels([], request.podIds.map(podId => contracts[podId])), gates: [], values: [] }
}
export function withMember(definition: WorkflowDefinition, podId: string, contract: GraphContract): Save {
  const { paused: _paused, nextAt: _nextAt, ...saved } = definition
  return { ...saved, type: 'save', nodes: [...definition.nodes.filter(node => node.podId !== podId), { podId, after: [], handoff: false }], channels: declaredChannels(definition.channels, [contract]) }
}
/** The smallest script that fulfils a contract: it hands every item on to the first given channel. */
export function contractScript(contract: GraphContract): string {
  const [first] = contract.gives
  const body = first ? `  for (const item of context.items) await context.emit(${JSON.stringify(first)}, { key: item.key, data: item.data })\n` : ''
  return `export const contract = ${JSON.stringify(contract, null, 2)}\n\nexport async function run(context) {\n${body}  return { status: 'completed', summary: \`\${context.items.length} items\`, completedInputIds: context.input.eventIds, gapIds: [] }\n}\n`
}
