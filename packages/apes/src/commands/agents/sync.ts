import { chownSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineCommand } from 'citty'
import consola from 'consola'
import { CliError } from '../../errors'
import { getHostId, getHostname } from '../../lib/macos-host'
import { resolveTroopUrl, TroopClient } from '../../lib/troop-client'

interface AuthJson {
  idp: string
  access_token: string
  email: string
  expires_at?: number
  key_path?: string
  owner_email?: string
}

const AUTH_PATH = join(homedir(), '.config', 'apes', 'auth.json')
const TASK_CACHE_DIR = join(homedir(), '.openape', 'agent', 'tasks')

function readAuthJson(): AuthJson {
  if (!existsSync(AUTH_PATH)) {
    throw new CliError(
      `No agent auth found at ${AUTH_PATH}. Run \`apes agents spawn <name>\` to provision an agent first.`,
    )
  }
  const raw = readFileSync(AUTH_PATH, 'utf8')
  let parsed: AuthJson
  try { parsed = JSON.parse(raw) as AuthJson }
  catch (err) {
    throw new CliError(`${AUTH_PATH} is not valid JSON: ${(err as Error).message}`)
  }
  if (!parsed.access_token) throw new CliError(`${AUTH_PATH} is missing access_token`)
  if (!parsed.email) throw new CliError(`${AUTH_PATH} is missing email`)
  // Agent addresses derived by deriveAgentEmail() in the IdP's enroll
  // endpoint look like:
  //   <safeName>-<ownerHash>+<owner-local>+<owner-domain>@<idp-host>
  // (e.g. "igor4-cb6bf26a+patrick+hofmann_eco@id.openape.ai"). The
  // distinguishing feature vs. a human address is the embedded `+` from
  // the subaddressing — humans never have that.
  if (!parsed.email.includes('+')) {
    throw new CliError(
      `${AUTH_PATH} email is "${parsed.email}" — expected an agent address (with embedded +owner+domain). Run \`apes agents spawn\` rather than calling sync from a human user.`,
    )
  }
  return parsed
}

function agentNameFromEmail(email: string): string {
  // <name>-<ownerHash>+<owner-local>+<owner-domain>@<idp-host>
  // The agent NAME is everything up to the last `-` before the first
  // `+` — the suffix `-<ownerHash>` is appended at registration time
  // to disambiguate same-named agents across owners.
  const before = email.split('+')[0]!
  const dashIdx = before.lastIndexOf('-')
  if (dashIdx <= 0) {
    // Pre-hash format (e.g. "agenta+patrick+hofmann_eco@…") — fall back
    // to the local-part as-is so we keep working with older agents.
    return before
  }
  return before.slice(0, dashIdx)
}

export const syncAgentCommand = defineCommand({
  meta: {
    name: 'sync',
    description: 'Pull this agent\'s task list from troop.openape.ai and reconcile launchd plists',
  },
  args: {
    'troop-url': {
      type: 'string',
      description: 'Override troop SP base URL (default: $OPENAPE_TROOP_URL or https://troop.openape.ai)',
    },
  },
  async run({ args }) {
    const auth = readAuthJson()
    const agentName = agentNameFromEmail(auth.email)
    const troopUrl = resolveTroopUrl(args['troop-url'] as string | undefined)
    const client = new TroopClient(troopUrl, auth.access_token)

    const hostId = getHostId()
    const host = getHostname()
    if (!hostId) {
      throw new CliError('Could not read IOPlatformUUID — is this macOS? Troop sync only works on macOS for v1.')
    }
    if (!auth.owner_email) {
      throw new CliError(`${AUTH_PATH} is missing owner_email — re-run \`apes agents spawn\` to update.`)
    }

    consola.start(`Syncing ${agentName} (${host}, hostId ${hostId.slice(0, 8)}…) with ${troopUrl}`)

    const sync = await client.sync({
      hostname: host,
      hostId,
      ownerEmail: auth.owner_email,
    })
    consola.info(sync.first_sync ? '✓ first sync — agent registered' : '✓ presence updated')

    const { system_prompt: systemPrompt, tools, tasks } = await client.listTasks()
    consola.info(`Pulled ${tasks.length} task${tasks.length === 1 ? '' : 's'}`)
    consola.info(`Tools enabled: ${tools.length === 0 ? '(none)' : tools.join(', ')}`)

    // Sync runs as ROOT in production (the launchd plist sets
    // UserName=root so it can write /Library/LaunchDaemons/ and
    // bootstrap into the system domain — a hidden service-account
    // agent has no permission for either). Files we write into the
    // agent's home need to be owned by the agent so the bridge daemon
    // and `apes agents run` (both running AS the agent) can read
    // them. Resolve agent's uid/gid by stat-ing $HOME — that's
    // already chown'd to the agent at spawn time.
    let agentUid: number | null = null
    let agentGid: number | null = null
    if (process.geteuid?.() === 0) {
      try {
        const homeStat = statSync(homedir())
        agentUid = homeStat.uid
        agentGid = homeStat.gid
      }
      catch { /* fall through, no chowning */ }
    }
    function chownToAgent(path: string): void {
      if (agentUid !== null && agentGid !== null) {
        try { chownSync(path, agentUid, agentGid) }
        catch { /* best-effort */ }
      }
    }

    // Cache full task specs + agent-level config locally so the bridge
    // daemon and `apes agents run <task_id>` can execute without going
    // to network. Cache layout:
    //   ~/.openape/agent/agent.json        — { systemPrompt }
    //   ~/.openape/agent/tasks/<task_id>.json
    const agentDir = join(homedir(), '.openape', 'agent')
    mkdirSync(agentDir, { recursive: true })
    chownToAgent(join(homedir(), '.openape'))
    chownToAgent(agentDir)
    const agentJsonPath = join(agentDir, 'agent.json')
    writeFileSync(
      agentJsonPath,
      `${JSON.stringify({ systemPrompt, tools }, null, 2)}\n`,
      { mode: 0o600 },
    )
    chownToAgent(agentJsonPath)
    mkdirSync(TASK_CACHE_DIR, { recursive: true })
    chownToAgent(TASK_CACHE_DIR)
    for (const task of tasks) {
      const path = join(TASK_CACHE_DIR, `${task.taskId}.json`)
      writeFileSync(path, `${JSON.stringify(task, null, 2)}\n`, { mode: 0o600 })
      chownToAgent(path)
    }

    // Cron tasks no longer get a per-task launchd plist (#347 was the
    // last attempt — too many failure modes for hidden agents). The
    // chat-bridge daemon's CronRunner ticks every 60s, reads these
    // task specs and fires the ones whose cron matches inside the
    // already-running ApesRpcSession. Sync just keeps the cache fresh.

    consola.success('Sync complete.')
  },
})
