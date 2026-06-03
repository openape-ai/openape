import { randomBytes } from 'node:crypto'
import { requireOwner } from '../../utils/auth'
import { buildNestComposeYaml, buildNestEnvFile } from '../../utils/hatch-bundle'
import { rememberHatchToken } from '../../utils/hatch-tokens'

// POST /api/nest/hatch — return everything a new operator host (or a
// hatched cloud VM) needs to come online as a nest under this owner.
//
// Response shape is a self-contained bundle: the docker-compose snippet,
// the .env values pre-seeded with the owner's troop SP URL + a freshly-
// minted enrollment token. The host runs:
//
//   curl -sS -X POST -H "Authorization: Bearer ..." troop.openape.ai/api/nest/hatch \
//     | jq -r .compose_yaml > docker-compose.yml
//   curl -sS ...                                       | jq -r .env_file > .env
//   docker compose up -d
//
// The enrollment token is short-lived (TTL 10 min) and single-use; the
// nest exchanges it on first WebSocket connect for a permanent agent
// identity scoped to the owner. Tokens that expire unredeemed are
// garbage-collected by the periodic cleanup.
//
// Cloud-provider adapters (Milestone H/I) call this internally before
// they boot a VM, then `scp` the resulting bundle to the new instance.

interface HatchResponse {
  enrollment_token: string
  expires_at: number
  compose_yaml: string
  env_file: string
}

export default defineEventHandler<Promise<HatchResponse>>(async (event) => {
  const ownerEmail = await requireOwner(event)
  const token = `nest-hatch-${randomBytes(24).toString('base64url')}`
  const expiresAt = Math.floor(Date.now() / 1000) + 600

  // The token lands in the same nest-hatch-tokens table the WS handler
  // checks on first connect. (Storage layer added in the same PR as
  // this endpoint — see server/utils/hatch-tokens.ts.)
  rememberHatchToken({ token, ownerEmail, expiresAt })

  const troopUrl = (useRuntimeConfig().troopUrl as string | undefined) ?? 'https://troop.openape.ai'

  return {
    enrollment_token: token,
    expires_at: expiresAt,
    compose_yaml: buildNestComposeYaml({ troopUrl, ownerEmail, hatchToken: token }),
    env_file: buildNestEnvFile(),
  }
})
