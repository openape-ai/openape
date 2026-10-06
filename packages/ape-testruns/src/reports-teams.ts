import { invalid } from '@openape/report-contracts/html'
import { reportsClient } from './reports-client'

const text = (description: string) => ({ type: 'string' as const, description })
const flag = (description: string) => ({ type: 'boolean' as const, description })
const endpoint = 'Uses the Reports team store and existing role checks. Does not send notifications. Invitations confer editor access when accepted; preserve tokens privately.'

export const teamCommands = {
  'teams create': { description: 'Create a team; the caller becomes owner', usage: '<name>', options: { description: text('Team description') }, details: endpoint },
  'teams show': { description: 'Show a team, its members and legacy plans', usage: '<team-id>', options: {}, details: endpoint },
  'teams members': { description: 'List team members and roles', usage: '<team-id>', options: {}, details: endpoint },
  'teams update': { description: 'Rename a team or change its description', usage: '<team-id>', options: { name: text('New team name'), description: text('New description; empty clears it') }, details: endpoint },
  'teams invite': { description: 'Create a team invitation', usage: '<team-id>', options: { 'max-uses': text('Positive integer, default 5'), 'expires-in': text('Duration, default 7d'), note: text('Invitation note') }, details: endpoint },
  'teams invites': { description: 'List active team invitations', usage: '<team-id>', options: {}, details: endpoint },
  'teams revoke-invite': { description: 'Revoke an invitation', usage: '<invite-id>', options: {}, details: endpoint },
  'teams accept': { description: 'Accept an invitation URL or token', usage: '<url-or-token>', options: {}, details: endpoint },
  'teams remove-member': { description: 'Remove a member from a team', usage: '<team-id> <email>', options: {}, details: endpoint },
  'teams archive': { description: 'Archive a team', usage: '<team-id>', options: {}, details: endpoint },
  'teams unarchive': { description: 'Restore an archived team', usage: '<team-id>', options: {}, details: endpoint },
  'teams rm': { description: 'Delete a team; refuses remaining plans unless forced', usage: '<team-id>', options: { force: flag('Also soft-delete remaining legacy plans') }, details: endpoint },
}

type Values = Record<string, string | boolean | string[] | undefined>
function value(values: Values, name: string): string | undefined {
  const result = values[name]
  return typeof result === 'string' ? result : undefined
}

export async function runTeamCommand(command: string, positionals: string[], values: Values): Promise<unknown> {
  const action = command.slice('teams '.length)
  if (positionals.length !== (action === 'remove-member' ? 2 : 1)) invalid(`Invalid arguments for ${command}; see --help`)
  const input = positionals[0]
  if (!input?.trim()) invalid('A nonempty team name, ID or invitation is required')
  const request = reportsClient(value(values, 'endpoint') ?? process.env.APE_REPORTS_ENDPOINT ?? 'https://report.openape.ai')
  const path = `/api/teams/${encodeURIComponent(input)}`
  if (action === 'create') return request('POST', '/api/teams', { name: input, description: value(values, 'description') })
  if (action === 'show' || action === 'members') {
    const team = await request('GET', path)
    return action === 'members' ? team.members : team
  }
  if (action === 'update') {
    const name = value(values, 'name'); const description = value(values, 'description')
    if (name === undefined && description === undefined) invalid('Supply --name or --description')
    return request('PATCH', path, { name, description: description === '' ? null : description })
  }
  if (action === 'invite') {
    const rawUses = value(values, 'max-uses')
    const maxUses = rawUses === undefined ? undefined : Number(rawUses)
    if (maxUses !== undefined && (!Number.isSafeInteger(maxUses) || maxUses < 1)) invalid('--max-uses must be a positive integer')
    return request('POST', `${path}/invites`, { max_uses: maxUses, expires_in: value(values, 'expires-in'), note: value(values, 'note') })
  }
  if (action === 'invites') return request('GET', `${path}/invites`)
  if (action === 'revoke-invite') return request('DELETE', `/api/invites/${encodeURIComponent(input)}`)
  if (action === 'accept') {
    let token = input
    if (input.includes('://')) {
      try { token = new URL(input).searchParams.get('t') ?? '' }
      catch { invalid('Invalid invitation URL') }
    }
    if (!token.trim()) invalid('Missing invitation token')
    return request('POST', '/api/invites/accept', { token })
  }
  if (action === 'remove-member') return request('DELETE', `${path}/members/${encodeURIComponent(positionals[1] ?? '')}`)
  if (action === 'archive' || action === 'unarchive') return request('POST', `${path}/${action}`)
  if (action === 'rm') return request('DELETE', `${path}${values.force ? '?force=true' : ''}`)
  return invalid(`Unknown team operation: ${action}`)
}
