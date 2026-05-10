import type { OpenApeGrant } from '@openape/core'

/**
 * A "grant pending" hook fires AFTER a grant has been created and survived
 * all pre-approval / standing-grant / similarity checks — i.e. it remains
 * status='pending' and a human will need to approve it. Consuming apps
 * register this hook to fan out a push / mail / etc. to the human.
 *
 * Why this isn't fired from the grant store's `save()`: pre-approval hooks
 * (YOLO etc.) run AFTER the initial save and update the grant to approved
 * via a follow-up `updateStatus`. A push fired at save-time would always
 * go out, even for grants the YOLO hook is about to auto-approve. That's
 * the inversion bug this hook fixes.
 */
export type GrantPendingHook = (grant: OpenApeGrant) => Promise<void> | void

const hooks: GrantPendingHook[] = []

/** Register a grant-pending hook. Usually called once from a Nitro plugin. */
export function defineGrantPendingHook(hook: GrantPendingHook): void {
  hooks.push(hook)
}

/** Fire-and-forget run of all registered hooks. Errors are logged + swallowed. */
export async function runGrantPendingHooks(grant: OpenApeGrant): Promise<void> {
  await Promise.all(hooks.map(async (hook) => {
    try {
      await hook(grant)
    }
    catch (err) {
      console.error('[grant-pending-hook] failed:', err)
    }
  }))
}
