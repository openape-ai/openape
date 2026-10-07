import type { H3Event } from 'h3'
import type { OpenApeGrant } from '@openape/core'
import { isAdmin } from './admin'
import { requireBrokerGrantOwner } from './broker-owner'
import { createProblemError } from './problem'
import { useIdpStores } from './stores'

export type GrantAction = 'approve' | 'deny' | 'revoke'

/**
 * Single source of the per-action grant authorization policy, shared by the
 * single-grant endpoints and the batch endpoint. Throws a 403 problem error
 * when `identity` may not perform `action` on `grant`.
 */
export async function requireGrantActionAuthority(
  event: H3Event,
  grant: OpenApeGrant,
  identity: string,
  action: GrantAction,
): Promise<void> {
  if (grant.brokered) {
    await requireBrokerGrantOwner(event, grant, action === 'approve')
    return
  }

  const requester = grant.request.requester
  if (action === 'approve' && identity === '_management_') return
  if (action === 'deny' && requester === identity) return

  const requesterUser = await useIdpStores().userStore.findByEmail(requester)

  if (action === 'revoke') {
    if (requester === identity || requesterUser?.approver === identity || isAdmin(identity)) return
    throw createProblemError({ status: 403, title: 'Only the requester, approver, or admin can revoke this grant' })
  }

  if (!requesterUser) {
    throw createProblemError({ status: 403, title: 'Requester not found for this grant' })
  }

  if (action === 'deny') {
    if (requesterUser.owner === identity || requesterUser.approver === identity) return
    throw createProblemError({ status: 403, title: 'Only the owner or approver can deny this grant' })
  }

  // Approver-policy resolution. Per the User type convention
  // (`packages/auth/src/idp/stores.ts:320`), `approver === undefined`
  // means "defaults to owner, or self when there is no owner". So:
  //
  //   approver explicitly set    -> only that approver (and the owner) may approve.
  //   approver unset, owner set  -> owner is the implicit approver (sub-user / agent).
  //   approver unset, owner unset -> top-level human, self-approval is implicit.
  //
  // A plain "requester may self-approve" shortcut would bypass the entire
  // delegation model: an agent with only its 1h IdP token could mint
  // itself authz_jwt for arbitrary audiences without the human owner
  // ever being involved. See security audit 2026-05-04.
  const isOwner = requesterUser.owner !== undefined && requesterUser.owner === identity
  const isExplicitApprover = requesterUser.approver !== undefined && requesterUser.approver === identity
  const isImplicitSelfApprove
    = requesterUser.approver === undefined
    && requesterUser.owner === undefined
    && requesterUser.email === identity
  if (!isOwner && !isExplicitApprover && !isImplicitSelfApprove) {
    throw createProblemError({ status: 403, title: 'Only the owner or approver can approve this grant' })
  }
}
