import type { ApprovalView } from './approvals'
import { dataFields, plainObject } from './fields'

export type ApprovalHistoryCommand = { type: 'list' } | { type: 'openApproval', id: string }
export interface ApprovalHistoryView { approvals: (ApprovalView & { podId: string })[] }

export function parseApprovalHistoryCommand(input: unknown): ApprovalHistoryCommand {
  const type = plainObject(input).type
  if (type !== 'list' && type !== 'openApproval') throw new Error('Invalid approval history command')
  const value = dataFields(input, type === 'list' ? ['type'] : ['type', 'id'])
  if (type === 'openApproval' && (typeof value.id !== 'string' || !value.id.trim() || value.id.length > 600)) throw new Error('Invalid approval ID')
  return structuredClone(value) as ApprovalHistoryCommand
}
