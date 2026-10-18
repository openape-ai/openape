import type { GrantType, OpenApeCliAuthorizationDetail, OpenApeGrant } from '@openape/core'
import type { SimilarGrantsResult, WideningSuggestion } from '@openape/grants'
import type { GrantWithCard } from './grant-card'

export type ApprovalGrant = GrantWithCard & { similar_grants?: SimilarGrantsResult, widening_suggestions?: WideningSuggestion[][] }
export interface ApprovalBody {
  grant_type: GrantType
  duration?: number
  widened_details?: OpenApeCliAuthorizationDetail[]
  extend_mode?: 'widen' | 'merge'
  extend_grant_ids?: string[]
}
export interface GrantDecisionResult { grant: OpenApeGrant, authz_jwt?: string }

export function grantDecisionError(error: unknown): string {
  const failure = error as { data?: { title?: string, statusMessage?: string }, message?: string }
  return failure.data?.title ?? failure.data?.statusMessage ?? failure.message ?? 'The decision could not be saved.'
}
