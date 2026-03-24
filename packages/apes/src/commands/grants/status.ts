import { defineCommand } from 'citty'
import { getIdpUrl } from '../../config'
import { apiFetch, getGrantsEndpoint } from '../../http'

interface GrantDetail {
  id: string
  type: string
  status: string
  requester: string
  owner: string
  approver?: string
  request: {
    command?: string[]
    grant_type?: string
    reason?: string
  }
  created_at?: string
  decided_at?: string
  decided_by?: string
  expires_at?: string
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
    console.log(`Type:      ${grant.type}`)
    console.log(`Requester: ${grant.requester}`)
    console.log(`Owner:     ${grant.owner}`)
    if (grant.approver)
      console.log(`Approver:  ${grant.approver}`)
    if (grant.request?.command)
      console.log(`Command:   ${grant.request.command.join(' ')}`)
    if (grant.request?.grant_type)
      console.log(`Approval:  ${grant.request.grant_type}`)
    if (grant.request?.reason)
      console.log(`Reason:    ${grant.request.reason}`)
    if (grant.decided_by)
      console.log(`Decided by: ${grant.decided_by}`)
    if (grant.decided_at)
      console.log(`Decided at: ${grant.decided_at}`)
    if (grant.expires_at)
      console.log(`Expires:   ${grant.expires_at}`)
  },
})
