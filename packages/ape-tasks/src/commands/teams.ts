import { defineCommand } from 'citty'
import { apiCall } from '../api.ts'
import { printJson, printLine } from '../output.ts'
import { getActiveTeamId, setActiveTeamId } from '../config.ts'

interface TeamListItem {
  id: string
  name: string
  description: string | null
  role: 'owner' | 'editor' | 'viewer'
  member_count: number
  plan_count: number
  created_at: number
  updated_at: number
}

interface TeamMember { email: string, role: 'owner' | 'editor' | 'viewer', joined_at: number }
interface TeamDetailPlan {
  id: string
  title: string
  status: 'draft' | 'active' | 'done' | 'archived'
  owner_email: string
  updated_at: number
  updated_by: string
}
interface TeamDetail {
  id: string
  name: string
  description: string | null
  created_at: number
  members: TeamMember[]
  plans: TeamDetailPlan[]
}

interface InviteSummary {
  id: string
  created_by: string
  note: string | null
  max_uses: number
  used_count: number
  expires_at: number
  created_at: number
}

interface CreateInviteResult {
  id: string
  url: string
  token: string
  expires_at: number
  max_uses: number
  note: string | null
}

/**
 * List, show, create, invite, and manage teams.
 *
 * EXAMPLES
 *   $ ape-tasks teams
 *   Delta Mind       role owner    members 3  plans 7
 *   Demo             role editor   members 2  plans 1
 *
 *   $ ape-tasks teams --json
 *   [{"id":"01HXX…","name":"Delta Mind","role":"owner", …}]
 *
 *   $ ape-tasks teams show 01HXX...
 *   (prints name, description, members, plans)
 *
 *   $ ape-tasks teams new "Delta Mind" --description "Core product team"
 *   → 01HXX…
 *
 *   $ ape-tasks teams invite 01HXX... --max-uses 1 --expires-in 24h --note "welcome @alice"
 *   https://tasks.openape.ai/invite?t=eyJhbGc…
 *
 *   $ ape-tasks teams invites 01HXX...
 *   (lists active invites with used/max and expiry)
 *
 *   $ ape-tasks teams revoke-invite 01HXX...
 *
 * JSON output (with --json) is stable and suitable for agent parsing.
 * Error codes:
 *   401  Not logged in. Run `ape-tasks login`.
 *   403  You are not a member / role too low.
 *   404  Team or invite not found.
 */
export const teamsCommand = defineCommand({
  meta: {
    name: 'teams',
    description: 'List teams you belong to.',
  },
  args: {
    json: { type: 'boolean', description: 'JSON output.' },
    'include-archived': { type: 'boolean', description: 'Include teams previously archived with `teams archive`.' },
    endpoint: { type: 'string', description: 'Override plans endpoint.' },
  },
  subCommands: {
    show: defineCommand({
      meta: {
        name: 'show',
        description: 'Print a team with members and plans.',
      },
      args: {
        teamId: { type: 'positional', required: true, description: 'Team ULID (from `ape-tasks teams --json`).' },
        json: { type: 'boolean', description: 'JSON output.' },
        endpoint: { type: 'string', description: 'Override plans endpoint.' },
      },
      async run({ args }) {
        const detail = await apiCall<TeamDetail>('GET', `/api/teams/${args.teamId}`, { endpoint: args.endpoint })
        if (args.json) { printJson(detail); return }
        printLine(`Team  ${detail.name}  (${detail.id})`)
        if (detail.description) printLine(`  ${detail.description}`)
        printLine('')
        printLine(`Members (${detail.members.length}):`)
        for (const m of detail.members) printLine(`  - ${m.email.padEnd(40)} ${m.role}`)
        printLine('')
        printLine(`Plans (${detail.plans.length}):`)
        for (const p of detail.plans) {
          printLine(`  - ${p.id}  ${p.status.padEnd(8)} ${p.title}`)
        }
      },
    }),

    new: defineCommand({
      meta: {
        name: 'new',
        description: 'Create a new team (caller becomes owner).',
      },
      args: {
        name: { type: 'positional', required: true, description: 'Team name (1–120 chars).' },
        description: { type: 'string', description: 'Optional description (≤500 chars).' },
        json: { type: 'boolean', description: 'JSON output.' },
        'id-only': { type: 'boolean', description: 'Print only the new team id.' },
        endpoint: { type: 'string', description: 'Override plans endpoint.' },
      },
      async run({ args }) {
        const result = await apiCall<TeamListItem>(
          'POST',
          '/api/teams',
          {
            endpoint: args.endpoint,
            body: { name: args.name, description: args.description },
          },
        )
        if (args['id-only']) { printLine(result.id); return }
        if (args.json) { printJson(result); return }
        printLine(result.id)
      },
    }),

    invite: defineCommand({
      meta: {
        name: 'invite',
        description: 'Create a shareable invite URL for a team.',
      },
      args: {
        teamId: { type: 'positional', required: true, description: 'Team ULID.' },
        'max-uses': { type: 'string', description: 'Max uses (default 5).' },
        'expires-in': { type: 'string', description: 'Duration e.g. 7d, 24h, 30m (default 7d).' },
        note: { type: 'string', description: 'Optional context shown to recipient.' },
        json: { type: 'boolean', description: 'JSON output.' },
        endpoint: { type: 'string', description: 'Override plans endpoint.' },
      },
      async run({ args }) {
        const maxUsesRaw = args['max-uses']
        const body: Record<string, unknown> = {}
        if (typeof maxUsesRaw === 'string' && maxUsesRaw.length > 0) {
          body.max_uses = parseInt(maxUsesRaw, 10)
        }
        if (args['expires-in']) body.expires_in = args['expires-in']
        if (args.note) body.note = args.note

        const result = await apiCall<CreateInviteResult>(
          'POST',
          `/api/teams/${args.teamId}/invites`,
          { endpoint: args.endpoint, body },
        )
        if (args.json) { printJson(result); return }
        printLine(result.url)
        printLine(`expires: ${new Date(result.expires_at * 1000).toISOString()}  uses: 0/${result.max_uses}`)
      },
    }),

    invites: defineCommand({
      meta: {
        name: 'invites',
        description: 'List active invites for a team.',
      },
      args: {
        teamId: { type: 'positional', required: true, description: 'Team ULID.' },
        json: { type: 'boolean', description: 'JSON output.' },
        endpoint: { type: 'string', description: 'Override plans endpoint.' },
      },
      async run({ args }) {
        const list = await apiCall<InviteSummary[]>(
          'GET',
          `/api/teams/${args.teamId}/invites`,
          { endpoint: args.endpoint },
        )
        if (args.json) { printJson(list); return }
        if (list.length === 0) { printLine('(no active invites)'); return }
        for (const inv of list) {
          printLine(
            `${inv.id}  ${inv.used_count}/${inv.max_uses} uses  exp ${new Date(inv.expires_at * 1000).toISOString()}${inv.note ? `  note: ${inv.note}` : ''}`,
          )
        }
      },
    }),

    'revoke-invite': defineCommand({
      meta: {
        name: 'revoke-invite',
        description: 'Revoke an invite by id.',
      },
      args: {
        inviteId: { type: 'positional', required: true, description: 'Invite ULID (from `ape-tasks teams invites <team>`).' },
        endpoint: { type: 'string', description: 'Override plans endpoint.' },
      },
      async run({ args }) {
        await apiCall('DELETE', `/api/invites/${args.inviteId}`, { endpoint: args.endpoint })
        printLine('revoked')
      },
    }),

    use: defineCommand({
      meta: {
        name: 'use',
        description: 'Set the default team so subsequent commands do not need --team.',
      },
      args: {
        teamId: { type: 'positional', required: false, description: 'Team ULID. Omit with --show or --clear.' },
        show: { type: 'boolean', description: 'Print the current default team id.' },
        clear: { type: 'boolean', description: 'Unset the default team.' },
        endpoint: { type: 'string', description: 'Override plans endpoint.' },
      },
      async run({ args }) {
        if (args.show) {
          const tid = getActiveTeamId(args.endpoint)
          printLine(tid ?? '(no default team set)')
          return
        }
        if (args.clear) {
          setActiveTeamId(null, args.endpoint)
          printLine('default team cleared')
          return
        }
        if (!args.teamId) throw Object.assign(new Error('Pass a team id, --show, or --clear.'), { status: 400, title: 'Missing argument' })
        // Validate membership before persisting — fails loudly instead of silently storing a bad id.
        await apiCall('GET', `/api/teams/${args.teamId}`, { endpoint: args.endpoint })
        setActiveTeamId(args.teamId, args.endpoint)
        printLine(`default team set to ${args.teamId}`)
      },
    }),

    update: defineCommand({
      meta: {
        name: 'update',
        description: 'Rename a team or change its description (owner only).',
      },
      args: {
        teamId: { type: 'positional', required: true, description: 'Team ULID.' },
        name: { type: 'string', description: 'New name (1–120 chars).' },
        description: { type: 'string', description: 'New description (≤500 chars). Pass empty string to clear.' },
        json: { type: 'boolean', description: 'JSON output.' },
        endpoint: { type: 'string', description: 'Override plans endpoint.' },
      },
      async run({ args }) {
        const body: Record<string, string | null> = {}
        if (typeof args.name === 'string') body.name = args.name
        if (typeof args.description === 'string') body.description = args.description.length === 0 ? null : args.description
        if (Object.keys(body).length === 0) {
          throw Object.assign(new Error('Pass --name or --description.'), { status: 400, title: 'No changes' })
        }
        const result = await apiCall<TeamListItem>('PATCH', `/api/teams/${args.teamId}`, {
          endpoint: args.endpoint,
          body,
        })
        if (args.json) { printJson(result); return }
        printLine(`${result.id}  ${result.name}${result.description ? `  — ${result.description}` : ''}`)
      },
    }),

    archive: defineCommand({
      meta: { name: 'archive', description: 'Archive a team — hides from default listings (owner only).' },
      args: {
        teamId: { type: 'positional', required: true, description: 'Team ULID.' },
        endpoint: { type: 'string', description: 'Override plans endpoint.' },
      },
      async run({ args }) {
        await apiCall('POST', `/api/teams/${args.teamId}/archive`, { endpoint: args.endpoint })
        printLine(`archived ${args.teamId}`)
      },
    }),

    unarchive: defineCommand({
      meta: { name: 'unarchive', description: 'Unarchive a previously archived team.' },
      args: {
        teamId: { type: 'positional', required: true, description: 'Team ULID.' },
        endpoint: { type: 'string', description: 'Override plans endpoint.' },
      },
      async run({ args }) {
        await apiCall('POST', `/api/teams/${args.teamId}/unarchive`, { endpoint: args.endpoint })
        printLine(`unarchived ${args.teamId}`)
      },
    }),

    rm: defineCommand({
      meta: {
        name: 'rm',
        description: 'Permanently delete a team (owner only). Refuses if plans exist unless --force.',
      },
      args: {
        teamId: { type: 'positional', required: true, description: 'Team ULID.' },
        force: { type: 'boolean', description: 'Cascade-soft-delete any remaining plans. Destructive.' },
        endpoint: { type: 'string', description: 'Override plans endpoint.' },
      },
      async run({ args }) {
        await apiCall('DELETE', `/api/teams/${args.teamId}`, {
          endpoint: args.endpoint,
          query: args.force ? { force: 'true' } : undefined,
        })
        printLine(`deleted team ${args.teamId}`)
        // Clear the active-team pointer if we just nuked the pointed-to team
        if (getActiveTeamId(args.endpoint) === args.teamId) setActiveTeamId(null, args.endpoint)
      },
    }),
  },
  async run({ args, rawArgs }) {
    // citty 0.1.6 runs the parent `run` even after a subcommand matched. Guard
    // so `ape-tasks teams <subcmd> ...` does not also spam the team list.
    const subCmds = ['show', 'new', 'invite', 'invites', 'revoke-invite', 'use', 'update', 'archive', 'unarchive', 'rm']
    const firstPositional = rawArgs.find(a => !a.startsWith('-'))
    if (firstPositional && subCmds.includes(firstPositional)) return

    const teams = await apiCall<TeamListItem[]>('GET', '/api/teams', {
      endpoint: args.endpoint,
      query: args['include-archived'] ? { include_archived: 'true' } : undefined,
    })
    if (args.json) { printJson(teams); return }
    if (teams.length === 0) { printLine('(no teams — create one with `ape-tasks teams new "<name>"`)'); return }
    const activeTid = getActiveTeamId(args.endpoint)
    for (const t of teams) {
      const marker = t.id === activeTid ? '* ' : '  '
      printLine(
        `${marker}${t.id}  ${t.name.padEnd(30)}  role ${t.role.padEnd(7)} members ${t.member_count}  plans ${t.plan_count}`,
      )
    }
  },
})
