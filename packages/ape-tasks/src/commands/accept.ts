import { defineCommand } from 'citty'
import { apiCall, createApiError } from '../api.ts'
import { printJson, printLine } from '../output.ts'

/**
 * Accept a team invite URL (or raw token).
 *
 * Works with either the full URL shown by `ape-tasks teams invite` or the
 * raw base64url token. Agents typically call this with the URL a human or
 * another agent sent to them.
 *
 * EXAMPLE
 *   $ ape-tasks accept https://tasks.openape.ai/invite?t=eyJhbGc...
 *   joined team 01HXX... as editor
 *
 *   $ ape-tasks accept eyJhbGc...
 *   already a member of team 01HXX... as owner
 *
 * ERRORS
 *   410  Invite is expired, revoked, or out of uses.
 *   401  Not logged in. Run `ape-tasks login <email>` first.
 */
export const acceptCommand = defineCommand({
  meta: {
    name: 'accept',
    description: 'Accept an invite URL or raw token.',
  },
  args: {
    urlOrToken: { type: 'positional', required: true, description: 'Invite URL or raw token.' },
    json: { type: 'boolean', description: 'JSON output.' },
    endpoint: { type: 'string', description: 'Override plans endpoint.' },
  },
  async run({ args }) {
    const token = extractToken(args.urlOrToken)
    if (!token) throw createApiError(400, 'Could not extract token', 'Pass the full invite URL or the raw token.')

    const result = await apiCall<{ team_id: string, team_role: string, already_member: boolean }>(
      'POST',
      '/api/invites/accept',
      { endpoint: args.endpoint, body: { token } },
    )

    if (args.json) { printJson(result); return }
    const verb = result.already_member ? 'already a member of' : 'joined'
    printLine(`${verb} team ${result.team_id} as ${result.team_role}`)
  },
})

function extractToken(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (trimmed.includes('://')) {
    try {
      const url = new URL(trimmed)
      return url.searchParams.get('t')
    }
    catch {
      return null
    }
  }
  return trimmed
}
