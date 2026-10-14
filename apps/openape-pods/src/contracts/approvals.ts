import { parseOwner } from '@openape/pods-protocol'
import type { Owner } from '@openape/pods-protocol'
import { canonicalJson } from './canonical-json'
import { parseSummary } from './grant-summary'
import type { GrantSummary } from './grant-summary'

/**
 * Owner approvals of single object actions (issue 1465), decided at the owner's IdP. Each item is one once-or-always
 * grant bound to exactly this Pod, action, object and payload hash; items of one Pod and action join one open IdP batch.
 * The audience stays the one of the former approve routes, so the IdP shows them alike. `program.run` approves one
 * exact application command (issue 1468): the approval is consumed by that one execution.
 */
export const approvalAudience = 'pods-graph-gate'
export const approvalActions = ['mail.archive', 'program.run'] as const
export type ApprovalAction = typeof approvalActions[number]
export type ApprovalState = 'collecting' | 'requested' | 'approved' | 'denied' | 'expired' | 'consumed' | 'withdrawn' | 'unknown'
/** The frozen binding of one item; its canonical JSON is the IdP command, so it never changes after the request. */
export interface ApprovalAuthority { version: 5, podId: string, owner: Owner, batchId: string, expiresAt: number, action: ApprovalAction, object: string, hash: string }
/** `summary` is what the IdP shows about the item (issue 1473); the authority alone binds what it allows. */
export interface ApprovalItem { key: string, authority: ApprovalAuthority, summary: GrantSummary }
/** What the worker sends the desktop for one batch operation; `grants` name the item grants of status/consume. */
export interface ApprovalManifest { podId: string, owner: Owner, batchId: string, title: string, expiresAt: number, items: ApprovalItem[] }
export interface ApprovalView { id: string, action: ApprovalAction, object: string, title: string, description: string | null, link: string | null, state: ApprovalState, reason: string | null, batchId: string | null, batchUrl: string | null, updatedAt: number }

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

export function approvalCommand(authority: ApprovalAuthority): string[] {
  return [approvalAudience, 'approve', canonicalJson(authority)]
}

export function parseApprovalAuthority(value: unknown): ApprovalAuthority {
  const input = value as Record<string, unknown> | null
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['version', 'podId', 'owner', 'batchId', 'expiresAt', 'action', 'object', 'hash'].includes(key))) throw new Error('Invalid approval authority')
  if (input.version !== 5 || !uuid(input.podId) || !uuid(input.batchId) || !Number.isSafeInteger(input.expiresAt) || !approvalActions.includes(input.action as ApprovalAction) || typeof input.object !== 'string' || !input.object || input.object.length > 500 || !hash(input.hash)) throw new Error('Invalid approval authority')
  return { version: 5, podId: input.podId, owner: parseOwner(input.owner), batchId: input.batchId, expiresAt: Number(input.expiresAt), action: input.action as ApprovalAction, object: input.object, hash: input.hash }
}

export function parseApprovalManifest(value: unknown): ApprovalManifest {
  const input = value as Record<string, unknown> | null
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['podId', 'owner', 'batchId', 'title', 'expiresAt', 'items'].includes(key))) throw new Error('Invalid approval batch')
  if (!uuid(input.podId) || !uuid(input.batchId) || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120 || !Number.isSafeInteger(input.expiresAt) || !Array.isArray(input.items) || !input.items.length || input.items.length > 100) throw new Error('Invalid approval batch')
  const owner = parseOwner(input.owner)
  const items = input.items.map((entry) => {
    const item = entry as Record<string, unknown>
    if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['key', 'authority', 'summary'].includes(key)) || !uuid(item.key)) throw new Error('Invalid approval item')
    const authority = parseApprovalAuthority(item.authority)
    const summary = parseSummary(item.summary)
    if (authority.podId !== input.podId || authority.batchId !== input.batchId || authority.expiresAt !== input.expiresAt || canonicalJson(authority.owner) !== canonicalJson(owner)) throw new Error('Approval item differs from its batch')
    return { key: item.key, authority, summary }
  })
  if (new Set(items.map(item => item.key)).size !== items.length) throw new Error('Duplicate approval item')
  return { podId: input.podId, owner, batchId: input.batchId, title: input.title, expiresAt: Number(input.expiresAt), items }
}
