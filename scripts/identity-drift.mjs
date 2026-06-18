#!/usr/bin/env node
// Owner diagnostic for the agent identity across stores.
//
// One agent is the DDISA email, copied into the queryable stores: IdP / troop
// `agents` / a tasks team's `team_members`. This script resolves a single
// identity across troop + tasks and reports drift, using the canonical
// reconciler in @openape/core (the same parser troop uses).
//
// Usage:
//   node scripts/identity-drift.mjs --team <tasks-team-id>
//
// Troop agents come from `apes agents list --json`. Tasks team members come
// from the tasks API using the cached sp-token.

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
if (!teamId) {
  console.error('usage: node scripts/identity-drift.mjs --team <tasks-team-id>')
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

const { identities, summary } = reconcileIdentities({ org: [], troop, tasks })

console.log(`\nIdentity drift — tasks team ${teamId} (“${team.name}”)`)
console.log(`troop agents: ${troop.length}  ·  tasks members: ${tasks.length}`)
console.log('─'.repeat(60))
console.log(['agent'.padEnd(22), 'troop', 'tasks'].join(' '))
for (const i of identities) {
  console.log([
    i.agentName.padEnd(22),
    i.inTroop ? '  ✓  ' : '  ·  ',
    i.inTasks ? '  ✓  ' : '  ·  ',
  ].join(' '))
}
console.log('─'.repeat(60))

// Main drift signal: a tasks-team member that is a real agent but has no troop
// agent identity (orphaned team membership).
const orphans = identities.filter(i => i.inTasks && !i.inTroop)
console.log(`agent identities seen: ${summary.total}  ·  human rows skipped: ${summary.humansSkipped}`)
console.log(`tasks members with NO troop agent (drift): ${orphans.length}${orphans.length ? ` → ${orphans.map(o => o.agentName).join(', ')}` : ''}`)
