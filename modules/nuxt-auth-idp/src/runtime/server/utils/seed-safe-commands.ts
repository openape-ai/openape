import type { OpenApeGrant } from '@openape/core'
import { buildSafeCommandRequest, SAFE_COMMAND_DEFAULTS } from '@openape/grants'
import type { ExtendedGrantStore } from './grant-store'

export interface SeedSafeCommandsResult {
  created: number
  skipped: number
}

/**
 * Seed the canonical 14 default safe-command standing grants for a given
 * (delegate, owner) pair. Idempotent: `cli_id`s already covered by a
 * default-reason standing grant are skipped.
 *
 * Storage shape mirrors `POST /api/standing-grants`: the request is
 * normalized with `requester=delegate` and `target_host='*'` so the
 * grants-table NOT NULL columns are satisfied and `findByRequester(agent)`
 * still returns these entries.
 */
export async function seedDefaultSafeCommands(
  delegate: string,
  owner: string,
  grantStore: ExtendedGrantStore,
): Promise<SeedSafeCommandsResult> {
  const existing = await grantStore.findByRequester(delegate)
  const existingDefaults = new Set<string>()
  for (const g of existing) {
    if (g.type !== 'standing') continue
    if (g.status !== 'approved') continue
    const req = g.request as { reason?: unknown, cli_id?: unknown } | undefined
    if (req?.reason !== 'safe-command:default') continue
    if (typeof req.cli_id === 'string') existingDefaults.add(req.cli_id)
  }

  const now = Math.floor(Date.now() / 1000)
  let created = 0
  let skipped = 0
  for (const def of SAFE_COMMAND_DEFAULTS) {
    if (existingDefaults.has(def.cli_id)) {
      skipped++
      continue
    }
    const req = buildSafeCommandRequest({
      cliId: def.cli_id,
      action: def.action,
      owner,
      delegate,
    })
    const storedRequest = {
      ...req,
      requester: delegate,
      target_host: '*',
    } as unknown as OpenApeGrant['request']
    const grant: OpenApeGrant = {
      id: crypto.randomUUID(),
      status: 'approved',
      type: 'standing',
      request: storedRequest,
      created_at: now,
      decided_at: now,
      decided_by: owner,
    }
    await grantStore.save(grant)
    created++
  }
  return { created, skipped }
}
