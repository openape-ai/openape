import { defineCommand } from 'citty'
import { getIdpUrl } from '../../config'
import { apiFetch, getGrantsEndpoint } from '../../http'

/**
 * Shape returned by `GET /grants/<id>` on the OpenApe IdP. Matches the
 * free-idp response as of 2026-04: `requester`, `target_host`, `audience`,
 * `grant_type`, etc. all live under the nested `request` object. Top-level
 * `type` is a legacy field that is currently always `null`. Timestamps are
 * unix seconds (numbers), not ISO strings.
 */
interface GrantDetail {
  id: string
  type?: string | null
  status: string
  request?: {
    requester?: string
    target_host?: string
    audience?: string
    grant_type?: string
    command?: string[]
    reason?: string
  }
  created_at?: number
  decided_at?: number
  decided_by?: string
  used_at?: number
  expires_at?: number
}

/** Unix seconds → ISO-8601 with graceful fallback for bogus values. */
function formatTs(ts: number | undefined): string | undefined {
  if (ts === undefined || ts === null)
    return undefined
  const ms = ts * 1000
  if (!Number.isFinite(ms))
    return undefined
  return new Date(ms).toISOString()
}

export const statusCommand = defineCommand({
  meta: {
    name: 'status',
    description: 'Show grant status',
  },
  args: {
    id: {
      type: 'positional',
      description: 'Grant ID',
      required: true,
    },
    json: {
      type: 'boolean',
      description: 'Output as JSON',
      default: false,
    },
  },
  async run({ args }) {
    const idp = getIdpUrl()!
    const grantsUrl = await getGrantsEndpoint(idp)
    const grant = await apiFetch<GrantDetail>(`${grantsUrl}/${args.id}`)

    if (args.json) {
      console.log(JSON.stringify(grant, null, 2))
      return
    }

    console.log(`Grant:     ${grant.id}`)
    console.log(`Status:    ${grant.status}`)
    if (grant.request?.audience)
      console.log(`Audience:  ${grant.request.audience}`)
    if (grant.request?.requester)
      console.log(`Requester: ${grant.request.requester}`)
    if (grant.request?.target_host)
      console.log(`Host:      ${grant.request.target_host}`)
    if (grant.request?.command)
      console.log(`Command:   ${grant.request.command.join(' ')}`)
    if (grant.request?.grant_type)
      console.log(`Approval:  ${grant.request.grant_type}`)
    if (grant.request?.reason)
      console.log(`Reason:    ${grant.request.reason}`)
    const createdAt = formatTs(grant.created_at)
    if (createdAt)
      console.log(`Created:   ${createdAt}`)
    if (grant.decided_by)
      console.log(`Decided by: ${grant.decided_by}`)
    const decidedAt = formatTs(grant.decided_at)
    if (decidedAt)
      console.log(`Decided at: ${decidedAt}`)
    const usedAt = formatTs(grant.used_at)
    if (usedAt)
      console.log(`Used at:   ${usedAt}`)
    const expiresAt = formatTs(grant.expires_at)
    if (expiresAt)
      console.log(`Expires:   ${expiresAt}`)
  },
})
