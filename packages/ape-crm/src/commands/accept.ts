import { defineCommand } from 'citty'
import { ApiError, apiCall } from '../api.ts'
import { setActiveWorkspaceId } from '../config.ts'
import { printJson, printLine } from '../output.ts'

/**
 * Accepts an invitation — either the full URL from `ape-crm workspaces
 * invite`, or the raw token.
 */
export const acceptCommand = defineCommand({
  meta: { name: 'accept', description: 'Accept an invite URL or raw token.' },
  args: {
    urlOrToken: { type: 'positional', required: true, description: 'Invite URL or raw token.' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override endpoint.' },
  },
  async run({ args }) {
    const token = extractToken(args.urlOrToken)
    if (!token) throw new ApiError(400, 'Could not extract token', 'Pass the full invite URL or the raw token.')

    const result = await apiCall<{ workspace_id: string, name: string, role: string, already_member: boolean }>(
      'POST',
      '/api/invites/accept',
      { endpoint: args.endpoint, body: { token } },
    )
    setActiveWorkspaceId(result.workspace_id)
    if (args.json) { printJson(result); return }
    printLine(`${result.already_member ? 'already a member of' : 'joined'} ${result.name} as ${result.role}`)
  },
})

export function extractToken(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (!trimmed.includes('://')) return trimmed
  try {
    return new URL(trimmed).searchParams.get('token')
  }
  catch {
    return null
  }
}
