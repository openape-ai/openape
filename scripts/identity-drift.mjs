#!/usr/bin/env node
// Owner diagnostic for the 4-fold agent identity (B0 / Milestone 1).
//
// One agent is the DDISA email, copied into four stores: IdP / troop `agents` /
// org `org_members` / a tasks team's `team_members`. This script resolves a
// single identity across the queryable stores and reports drift, using the
// canonical reconciler in @openape/core (the same parser troop uses).
//
// Usage:
//   node scripts/identity-drift.mjs --team <tasks-team-id> [--org <org-id>]
//
// Troop agents come from `apes agents list --json`. Tasks team members come
// from the tasks API using the cached sp-token. Org members are fetched only
// when --org is given AND an org sp-token is cached (else that axis is skipped
// and the report says so — it is not silently treated as empty).

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { reconcileIdentities } from '@openape/core'

const args = process.argv.slice(2)
function flag(name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const teamId = flag('--team')
const orgId = flag('--org')
if (!teamId) {
  console.error('usage: node scripts/identity-drift.mjs --team <tasks-team-id> [--org <org-id>]')
  process.exit(2)
}

function spToken(aud) {
  try {
    return JSON.parse(readFileSync(join(homedir(), '.config/apes/sp-tokens', `${aud}.json`), 'utf8')).access_token
  }
  catch {
    return null
  }
}

async function apiGet(base, path, token) {
  const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`)
  return res.json()
}

// --- troop agents (via apes CLI) ---
const troop = JSON.parse(
  execFileSync('apes', ['agents', 'list', '--json'], { env: { ...process.env, APES_NO_UPDATE_CHECK: '1' } }).toString(),
).map(a => ({ email: a.email }))

// --- tasks team members (via tasks API) ---
const tasksTok = spToken('tasks.openape.ai')
if (!tasksTok) {
  console.error('No cached tasks.openape.ai sp-token — run `ape-tasks list` once to mint it.')
  process.exit(1)
}
const team = await apiGet('https://tasks.openape.ai', `/api/teams/${teamId}`, tasksTok)
const tasks = (team.members ?? []).map(m => ({ userEmail: m.email }))

// --- org members (optional axis) ---
let org = []
let orgQueried = false
if (orgId) {
  const orgTok = spToken('org.openape.ai')
  if (orgTok) {
    const members = await apiGet('https://org.openape.ai', `/api/orgs/${orgId}/members`, orgTok)
    org = (Array.isArray(members) ? members : members.members ?? []).map(m => ({ agentEmail: m.agent_email ?? m.agentEmail }))
    orgQueried = true
  }
}

const { identities, summary } = reconcileIdentities({ org, troop, tasks })

console.log(`\nIdentity drift — tasks team ${teamId} (“${team.name}”)`)
console.log(`troop agents: ${troop.length}  ·  tasks members: ${tasks.length}  ·  org members: ${orgQueried ? org.length : 'NOT QUERIED (no --org / no org token)'}`)
console.log('─'.repeat(72))
console.log(['agent'.padEnd(22), 'org', 'troop', 'tasks', orgQueried ? 'status' : ''].join(' '))
for (const i of identities) {
  console.log([
    i.agentName.padEnd(22),
    (orgQueried ? (i.inOrg ? ' ✓ ' : ' · ') : ' ? '),
    i.inTroop ? '  ✓  ' : '  ·  ',
    i.inTasks ? '  ✓  ' : '  ·  ',
    orgQueried ? i.status : '',
  ].join(' '))
}
console.log('─'.repeat(72))

// Reachable drift signal regardless of the org axis: a tasks-team member that
// is a real agent but has no troop agent identity (orphaned team membership).
const orphans = identities.filter(i => i.inTasks && !i.inTroop)
console.log(`agent identities seen: ${summary.total}  ·  human rows skipped: ${summary.humansSkipped}`)
console.log(`tasks members with NO troop agent (drift): ${orphans.length}${orphans.length ? ` → ${orphans.map(o => o.agentName).join(', ')}` : ''}`)
if (orgQueried) console.log(`org∧troop linked: ${summary.linked}  ·  partial: ${summary.partial}`)
else console.log('note: org axis not queried — pass --org + cache an org sp-token for org∧troop status.')
