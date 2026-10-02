import { dataFields, dataRevision } from './network-data'
import { workflowIdentity } from './workflow-ports'
import { parseNetworkCommand, parseNetworkDefinition } from './networks'
import { parseWorkflowView } from './workflows'
import type { WorkflowDefinition } from './workflows'
import { parseNetworkMemberView } from './network-operations'
import type { NetworkMemberView } from './network-operations'
import { parseSchedule } from './scheduling'
import type { ScheduleSpec } from './scheduling'
import type { NetworkDraft, NetworkDefinition } from './networks'

export interface ConversionSelection {
  workflowId: string
  revision: number
  draft: NetworkDraft
  checkpoints: { podId: string, revision: number, hash: string, scriptHash: string, explicitSourceVersions: boolean }[]
  pending: 'block' | 'retainLegacy'
}

function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid conversion review digest')
  return value
}

export function parseConversionSelection(value: unknown): ConversionSelection {
  const input = dataFields(value, ['workflowId', 'revision', 'draft', 'checkpoints', 'pending'])
  const draft = parseNetworkCommand({ type: 'create', draft: input.draft })
  if (draft.type !== 'create' || !['block', 'retainLegacy'].includes(String(input.pending))) throw new Error('Invalid conversion review')
  const revision = dataRevision(input.revision)
  if (!revision || !Array.isArray(input.checkpoints) || input.checkpoints.length > 64) throw new Error('Invalid conversion review')
  const checkpoints = input.checkpoints.map((value) => {
    const checkpoint = dataFields(value, ['podId', 'revision', 'hash', 'scriptHash', 'explicitSourceVersions'])
    if (typeof checkpoint.explicitSourceVersions !== 'boolean') throw new Error('Review explicit source item versions before conversion')
    return { podId: workflowIdentity(checkpoint.podId), revision: dataRevision(checkpoint.revision), hash: hash(checkpoint.hash), scriptHash: hash(checkpoint.scriptHash), explicitSourceVersions: checkpoint.explicitSourceVersions }
  })
  if (new Set(checkpoints.map(item => item.podId)).size !== checkpoints.length) throw new Error('Duplicate source checkpoint review')
  return { workflowId: workflowIdentity(input.workflowId), revision, draft: draft.draft, checkpoints, pending: input.pending as ConversionSelection['pending'] }
}

export type ConversionCommand = { type: 'conversionPreview', selection: ConversionSelection } | { type: 'convert', selection: ConversionSelection, expectedFingerprint: string }
export function parseConversionCommand(value: unknown): ConversionCommand {
  const input = dataFields(value, ['type', 'selection'], ['expectedFingerprint'])
  const selection = parseConversionSelection(input.selection)
  if (input.type === 'conversionPreview') { dataFields(input, ['type', 'selection']); return { type: 'conversionPreview', selection } }
  if (input.type !== 'convert') throw new Error('Invalid conversion command')
  return { type: 'convert', selection, expectedFingerprint: hash(input.expectedFingerprint) }
}

export interface ConversionPreview {
  fingerprint: string
  legacy: WorkflowDefinition
  draft: NetworkDraft
  candidate: NetworkDefinition | null
  issues: string[]
  pending: number
  members: (NetworkMemberView & { checkpoint: { revision: number, hash: string, scriptHash: string, body: string, truncated: boolean }, schedule: { spec: ScheduleSpec, revision: number, enabled: boolean, nextAt: number | null } | null })[]
  differences: string[]
}

export function parseConversionPreview(value: unknown): ConversionPreview {
  const input = dataFields(value, ['fingerprint', 'legacy', 'draft', 'candidate', 'issues', 'pending', 'members', 'differences'])
  hash(input.fingerprint); dataRevision(input.pending)
  parseWorkflowView({ workflows: [input.legacy], runs: [] })
  parseNetworkCommand({ type: 'create', draft: input.draft })
  if (input.candidate !== null) parseNetworkDefinition(input.candidate)
  for (const key of ['issues', 'differences'] as const) {
    if (!Array.isArray(input[key]) || input[key].length > 512 || input[key].some(item => typeof item !== 'string' || item.length > 4000)) throw new Error('Invalid conversion diagnostics')
  }
  if (!Array.isArray(input.members) || input.members.length > 64) throw new Error('Invalid conversion members')
  for (const value of input.members) {
    const item = dataFields(value, ['podId', 'name', 'lifecycle', 'capabilities', 'triggers', 'values', 'resources', 'resourcesMore', 'checkpoint', 'schedule'], ['diagnostic'])
    const { checkpoint, schedule, ...member } = item
    parseNetworkMemberView(member)
    const pin = dataFields(checkpoint, ['revision', 'hash', 'scriptHash', 'body', 'truncated']); dataRevision(pin.revision); hash(pin.hash); hash(pin.scriptHash)
    if (typeof pin.body !== 'string' || pin.body.length > 65536 || typeof pin.truncated !== 'boolean') throw new Error('Invalid checkpoint preview')
    if (schedule !== null) {
      const timing = dataFields(schedule, ['spec', 'revision', 'enabled', 'nextAt'])
      parseSchedule(timing.spec); dataRevision(timing.revision)
      if (typeof timing.enabled !== 'boolean') throw new Error('Invalid conversion schedule')
      if (timing.nextAt !== null) dataRevision(timing.nextAt)
    }
  }
  return input as unknown as ConversionPreview
}
