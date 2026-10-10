import { randomUUID } from 'node:crypto'
import type { GraphContract } from '../../src/contracts/graphs'
import { approveGate, chooseGate, choiceEvents, choicePayload } from '../renderer/choice-events'
import type { ScheduleSpec } from '../../src/contracts/scheduling'
import { installExample } from '../../src/worker/runs/examples'
import { digest } from '../../src/worker/storage/database'
import { PodGroups } from '../../src/worker/workspace/groups'
import { networkFixture } from '../scheduling/network-fixture'

export { approveGate, chooseGate, choiceEvents }

/**
 * A synthetic profile shaped like the installed one of 6 October 2026: 38 Pods in the groups
 * Delta Mind, iurio and Linde plus six without a group; one active persistent mail network with a
 * choose and an approve gate, one active daily chain, two paused bounded graphs, one paused
 * chain and standalone monitors. Names and counts follow the redesign mock; no row carries a
 * secret value. `NOW` is the snapshot time the mock was captured at.
 */
export const NOW = 1791284728000
const HOUR = 3600000
const hash = 'a'.repeat(64)
const uuid = () => randomUUID()

export const mailContracts: Record<string, GraphContract> = {
  'Intake': { takes: [], gives: ['mail.open', 'mail.sent-raw'], summary: 'Reads inbox and sent mail' },
  'Sent mail': { takes: ['mail.sent-raw'], gives: ['mail.sent'], summary: 'Records sent messages' },
  'List filter': { takes: ['mail.open'], gives: ['mail.filtered'], summary: 'Applies contact protection' },
  'Triage': { takes: ['mail.filtered'], gives: ['mail.triaged'], summary: 'Assesses urgency and relevance' },
  'Categorisation': { takes: ['mail.triaged'], gives: ['mail.useful', 'mail.newsletter', 'mail.invoice', 'mail.reply', 'mail.unsure'], summary: 'Routes reviewed mail' },
  'Review': { takes: ['mail.useful'], gives: ['mail.reviewed'], summary: 'Prepares useful mail review' },
  'Newsletter batch': { takes: ['mail.newsletter'], gives: ['mail.batch'], summary: 'Collects newsletter candidates' },
  'Invoice preview': { takes: ['mail.invoice'], gives: ['invoice.candidate'], summary: 'Reviews invoices without filing' },
  'Reply drafts': { takes: ['mail.reply'], gives: ['draft.candidate'], summary: 'Previews reply drafts' },
  'Archive preview': { takes: ['mail.approved'], gives: [], summary: 'Records approved preview decisions' },
  'Memory': { takes: ['mail.sent', 'mail.reviewed', 'invoice.candidate', 'draft.candidate', 'mail.excluded', 'mail.unsure'], gives: [], summary: 'Records nonnewsletter activity' },
}
export const mailChannels = ['mail.open', 'mail.sent-raw', 'mail.filtered', 'mail.triaged', 'mail.useful', 'mail.newsletter', 'mail.invoice', 'mail.reply', 'mail.unsure', 'mail.batch', 'mail.approved', 'mail.reviewed', 'invoice.candidate', 'draft.candidate', 'mail.sent', 'mail.excluded']

const o365 = (account: string, displays: string[]) => ({ type: 'program', stateId: uuid(), capability: `tool.app_${uuid().replaceAll('-', '')}.invoke`, cliId: 'o365-cli', name: 'o365-cli', executable: 'o365-cli', executableHash: hash, adapterPath: '/unused', adapterHash: hash, networkHosts: [], entryFiles: [], environment: {}, grants: displays.map(display => ({ permission: `o365.account[email=${account}].mail[*]#${display.startsWith('Move') ? 'move' : 'list'}`, display })) })
const program = (cliId: string, grants: { permission: string, display: string }[]) => ({ type: 'program', stateId: uuid(), capability: `tool.app_${uuid().replaceAll('-', '')}.invoke`, cliId, name: cliId, executable: cliId, executableHash: hash, adapterPath: '/unused', adapterHash: hash, networkHosts: [], entryFiles: [], environment: {}, grants })
const http = (origin: string, methods: string[]) => ({ type: 'http', origin, methods, capability: `tool.http_${uuid().replaceAll('-', '')}.request` })
const directory = (path: string, access: 'read' | 'readWrite') => ({ path, access, device: '1', inode: '1' })
const credential = (alias: string) => ({ alias, credentialId: uuid() })
const jev = { type: 'jev', capability: 'jev.evaluate', connectionId: uuid(), model: 'jev-1.13.0', maxAttempts: 20, authority: {} }
const ssh = (alias: string) => ({ type: 'sshInventory', target: { alias, jumps: [], profile: 'linde-server-v1' }, hosts: [alias], knownHosts: '', profileHash: hash, authority: {}, capability: `tool.ssh_${uuid().replaceAll('-', '')}.read` })

export function mapFixture() {
  const f = networkFixture()
  const { store, resources, groupId: deltaMind } = f
  const groups = new PodGroups(store)
  groups.execute({ type: 'organize', action: 'rename', id: deltaMind, name: 'Delta Mind', revision: groups.view().revision })
  const group = (name: string) => { groups.execute({ type: 'organize', action: 'create', name, revision: groups.view().revision }); return groups.view().groups.at(-1)!.id }
  const iurio = group('iurio'); const linde = group('Linde')
  const pods: Record<string, string> = {}

  // Program grants are Pod grants in the ledger, apart from the sandbox entry of the application.
  const resource = (podId: string, kind: string, name: string, { grants, ...configuration }: Record<string, unknown>) => {
    store.db.prepare('INSERT INTO resources VALUES(?,?,1,?,\'ready\',?,?)').run(uuid(), podId, kind, name, JSON.stringify(configuration))
    for (const grant of (grants ?? []) as { permission: string, display: string }[]) store.db.prepare('INSERT INTO pod_grants VALUES(?,?,?,?,?,?,?,\'always\',\'approved\',NULL,NULL,0,?,?)').run(uuid(), podId, 'https://id.example.invalid', `pod-${podId}`, String(configuration.cliId), JSON.stringify([{ type: 'openape_cli', cli_id: configuration.cliId, operation_id: '*', resource_chain: [], action: grant.permission.split('#')[1], permission: grant.permission, display: grant.display, risk: 'low' }]), grant.display, NOW, NOW)
  }
  const scripted = (name: string, groupId: string | null, options: { contract?: GraphContract, capabilities?: string[], lifecycle?: 'active' | 'paused' | 'archived', draft?: boolean } = {}) => {
    const pod = store.createPod({ name })
    if (groupId) groups.execute({ type: 'organize', action: 'move', podId: pod.id, groupId, revision: groups.view().revision })
    if (!options.draft) {
      installExample(store, resources, pod.id, 'deterministic', hash)
      const manifest = JSON.parse(store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=?').get(pod.id)!.manifest as string)
      const code = `export const contract=${JSON.stringify(options.contract ?? null)};\nexport async function run() { return { status: 'completed', summary: 'fixture', completedInputIds: [], gapIds: [] } }\n`
      const scriptHash = digest(code)
      store.storeScript(pod.id, { ...manifest, contentHash: scriptHash, capabilities: options.capabilities ?? [], ...(options.contract ? { contract: options.contract } : {}) }, code)
      store.db.prepare('UPDATE pods SET active_script=? WHERE id=?').run(scriptHash, pod.id)
    }
    store.db.prepare('UPDATE pods SET lifecycle=? WHERE id=?').run(options.lifecycle ?? 'active', pod.id)
    pods[name] = pod.id
    return pod.id
  }
  const schedule = (podId: string, spec: ScheduleSpec, enabled: boolean) => store.db.prepare('INSERT INTO schedules(pod_id,revision,spec,enabled) VALUES(?,1,?,?)').run(podId, JSON.stringify(spec), enabled ? 1 : 0)
  const run = (podId: string, at: number, state: string, summary: string, effects = 0) => {
    const id = uuid()
    store.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,NULL,0,1)').run(id, podId, store.getPod(podId).activeScript ?? hash, state, at, state === 'running' ? null : at + 1000, summary)
    for (let index = 0; index < effects; index++) store.db.prepare('INSERT INTO effect_ledger VALUES(?,?,\'http.request\',?,?,\'completed\',NULL)').run(podId, `${id}:${index}`, hash, id)
    return id
  }

  // Delta Mind mail network: eleven members, Intake as the only source every 15 minutes.
  for (const [name, contract] of Object.entries(mailContracts)) pods[name] = f.pod(name, contract, async () => {})
  store.db.prepare('UPDATE scripts SET manifest=json_set(manifest,\'$.capabilities\',json(\'["jev.evaluate"]\')) WHERE pod_id=?').run(pods.Triage!)
  const members = Object.keys(mailContracts).map(name => ({ podId: pods[name]!, source: name === 'Intake' ? { schedule: { kind: 'interval' as const, seconds: 900 } } : null, serialCase: false }))
  const network = f.engine.execute({ type: 'create', draft: { name: 'Delta Mind · Mail-Netzwerk', groupId: deltaMind, members, channels: mailChannels.map(name => ({ name, title: name, schemaVersion: 1, schema: { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'], additionalProperties: false } })), routes: [chooseGate, approveGate] } }).createdId!
  store.db.prepare('UPDATE networks SET state=\'active\' WHERE id=?').run(network)
  store.db.prepare('INSERT INTO network_queue_counts VALUES(?,\'done\',80)').run(network)
  resource(pods.Intake!, 'tool', 'o365-cli', o365('phofmann@delta-mind.at', ['List emails in inbox for phofmann@delta-mind.at', 'Read email from account phofmann@delta-mind.at']))
  resource(pods.Intake!, 'directory', 'delta', directory('/Users/fixture/Pods/delta', 'readWrite'))
  resource(pods.Triage!, 'tool', 'TypeSafe / Jev', jev)
  resource(pods.Triage!, 'directory', 'delta', directory('/Users/fixture/Pods/delta', 'readWrite'))
  resource(pods['Archive preview']!, 'tool', 'o365-cli', o365('phofmann@delta-mind.at', ['Move approved mail for phofmann@delta-mind.at']))
  const member = (podId: string) => store.db.prepare('SELECT definition_id,definition_version FROM network_members WHERE pod_id=?').get(podId)!
  const event = (producer: string, channel: string, at: number, payload: Record<string, unknown>, id = uuid()) => store.transaction(() => {
    const caseId = uuid()
    store.db.prepare('INSERT INTO network_cases(id,network_id,group_id,current_revision,created_at) VALUES(?,?,?,1,?)').run(caseId, network, deltaMind, at)
    store.db.prepare('INSERT INTO network_case_revisions(case_id,revision,source_mapping,outcome,created_at) VALUES(?,1,\'{}\',\'open\',?)').run(caseId, at)
    const producerId = pods[producer] ?? producer
    const { definition_id, definition_version } = member(producerId)
    store.db.prepare('INSERT INTO network_events(id,network_id,network_revision,producer_pod_id,definition_id,definition_version,case_id,case_revision,channel,item_key,origin,schema_hash,payload,payload_hash,accepted_at) VALUES(?,?,1,?,?,?,?,1,?,?,\'{}\',?,?,?,?)').run(id, network, producerId, definition_id, definition_version, caseId, channel, id, hash, JSON.stringify(payload), hash, at)
    return id
  })
  const flows: [string, string, number][] = [['Intake', 'mail.open', 3], ['List filter', 'mail.filtered', 7], ['Triage', 'mail.triaged', 8], ['Categorisation', 'mail.useful', 1], ['Categorisation', 'mail.reply', 1], ['Review', 'mail.reviewed', 1], ['Reply drafts', 'draft.candidate', 1]]
  for (const [producer, channel, count] of flows) {
    for (let index = 0; index < count; index++) event(producer, channel, NOW - HOUR - index * 60000, { subject: `${channel} ${index}` })
  }
  for (const recorded of choiceEvents) {
    const at = Date.parse(recorded[6])
    const id = event('Categorisation', 'mail.unsure', at, choicePayload(recorded))
    store.db.prepare('INSERT INTO network_choices(network_id,network_revision,event_id,gate_key) VALUES(?,1,?,?)').run(network, id, chooseGate.key)
  }
  for (const name of ['Intake', 'List filter', 'Triage', 'Categorisation']) {
    for (let index = 0; index < 10; index++) run(pods[name]!, NOW - HOUR - index * 900000, 'completed', `${name} completed`)
  }
  store.db.prepare('UPDATE runs SET summary=\'Read 6 sampled messages and emitted 0 changed provider versions. No mailbox writes.\' WHERE pod_id=? AND started_at=(SELECT max(started_at) FROM runs WHERE pod_id=?)').run(pods.Intake!, pods.Intake!)

  // Morgenbriefing: an active daily chain of four Pods without a group.
  const mp = scripted('Mail-Prüfung · Morgenbriefing', null, { capabilities: ['jev.evaluate'] })
  resource(mp, 'tool', 'pods-mail', program('pods-mail', [{ permission: 'pods-mail.account[email=phofmann@delta-mind.at].mail[*]#list', display: 'List mail for phofmann@delta-mind.at' }, { permission: 'pods-mail.account[email=patrick@docpit.eu].mail[*]#list', display: 'List mail for patrick@docpit.eu' }]))
  resource(mp, 'directory', 'mail', directory('/Users/fixture/Briefing Evidence/mail', 'readWrite'))
  schedule(mp, { kind: 'interval', seconds: 60 }, true)
  const ki = scripted('Morgenbriefing · Kalender und Issues', null)
  resource(ki, 'tool', 'o365-cli', o365('phofmann@delta-mind.at', ['Read today calendar for phofmann@delta-mind.at']))
  resource(ki, 'tool', 'repos-issues', program('repos-issues', [{ permission: 'repos-issues.issue[*]#list', display: 'Read open issues' }]))
  const red = scripted('Morgenbriefing · Redaktion', null)
  resource(red, 'directory', 'mail', directory('/Users/fixture/Briefing Evidence/mail', 'read'))
  const bot = scripted('Morgenbriefing · Calendar-Bot', null)
  resource(bot, 'tool', 'https://api.telegram.org', http('https://api.telegram.org', ['GET', 'POST']))
  resource(bot, 'tool', 'https://report.openape.ai', http('https://report.openape.ai', ['GET', 'POST']))
  resource(bot, 'credential', 'calendar_bot_token', credential('calendar_bot_token'))
  resource(bot, 'credential', 'reports_publisher_key', credential('reports_publisher_key'))
  const briefing = uuid()
  store.db.prepare('INSERT INTO workflows(id,revision,name,nodes,schedule,enabled,paused,mode,group_id) VALUES(?,3,?,?,?,1,0,\'sequence\',NULL)').run(briefing, 'Morgenbriefing', JSON.stringify([{ podId: mp, after: [], handoff: false }, { podId: ki, after: [mp], handoff: true }, { podId: red, after: [ki], handoff: true }, { podId: bot, after: [red], handoff: true }]), JSON.stringify({ kind: 'daily', time: '07:00', timezone: 'Europe/Vienna' }))
  for (const podId of [mp, ki, red, bot]) store.db.prepare('INSERT INTO workflow_members VALUES(?,?)').run(briefing, podId)
  store.db.prepare('INSERT INTO workflow_runs(id,workflow_id,revision,definition,trigger,state,reason,started_at,finished_at) VALUES(?,?,3,?,\'schedule\',\'completed\',NULL,?,?)').run(uuid(), briefing, JSON.stringify({ nodes: [] }), NOW - 6 * HOUR, NOW - 6 * HOUR + 60000)
  for (let index = 0; index < 50; index++) run(mp, NOW - index * 60000 - 60000, 'completed', 'No pending mail archive decisions')
  for (const [podId, summary] of [[ki, 'Calendar and issue sources collected for 2026-10-06'], [red, 'German editorial report ready for 2026-10-06'], [bot, 'Telegram delivery confirmed for 2026-10-06; message 245']] as const) run(podId, NOW - 6 * HOUR, 'completed', summary, podId === bot ? 2 : 0)
  // One Telegram delivery of the bot never got its answer: the owner reconciles it in Entscheidungen.
  store.db.prepare('UPDATE effect_ledger SET state=\'unknown\' WHERE pod_id=? AND rowid=(SELECT min(rowid) FROM effect_ledger WHERE pod_id=?)').run(bot, bot)

  // Standalone monitors in iurio and without a group.
  const pr = scripted('IURIO PR monitor', iurio)
  resource(pr, 'tool', 'az', program('az', [{ permission: 'az.organization[url=https://dev.azure.com/iurio].project[name=iurioServer].repo[name=iurioServer].pull-request[*]#list', display: 'List pull requests for repository iurioServer' }]))
  resource(pr, 'tool', 'https://dev.azure.com', http('https://dev.azure.com', ['GET']))
  resource(pr, 'tool', 'https://api.telegram.org', http('https://api.telegram.org', ['POST']))
  resource(pr, 'credential', 'telegram_bot_token', credential('telegram_bot_token'))
  schedule(pr, { kind: 'interval', seconds: 900 }, true)
  for (let index = 1; index <= 5; index++) run(pr, NOW - index * 900000, 'completedWithGaps', 'Azure read incomplete; no monitoring success claimed.', 1)
  const prRun = run(pr, NOW - 200000, 'running', 'Läuft seit 13:01')
  store.db.prepare('INSERT INTO run_events VALUES(?,1,\'approval\',?,?)').run(prRun, JSON.stringify({ grantId: 'grant-pr-monitor', issuer: 'https://id.openape.ai', state: 'pending', title: 'Execution permission for IURIO PR monitor' }), NOW - 200000)
  const task = scripted('IURIO Task monitor', iurio)
  resource(task, 'tool', 'iurio', program('iurio', [{ permission: 'iurio.project[id=125].workspace[id=427].task[*]#list', display: 'Read all active tasks in the IURIO development board' }]))
  resource(task, 'tool', 'https://api.telegram.org', http('https://api.telegram.org', ['POST']))
  resource(task, 'credential', 'telegram_bot_token', credential('telegram_bot_token'))
  schedule(task, { kind: 'interval', seconds: 300 }, true)
  for (let index = 0; index < 30; index++) run(task, NOW - index * 300000 - 120000, 'completed', 'Unchanged: 204 tasks. No model call or Telegram message.', index % 4 === 0 ? 1 : 0)
  const zaz = scripted('zaz Service-Agent', null)
  resource(zaz, 'tool', 'https://zaz.delta-mind.at', http('https://zaz.delta-mind.at', ['GET', 'POST']))
  resource(zaz, 'credential', 'zaz_agent_key', credential('zaz_agent_key'))
  schedule(zaz, { kind: 'interval', seconds: 60 }, true)
  for (let index = 0; index < 150; index++) run(zaz, NOW - index * 60000 - 30000, 'completed', 'zaz queue empty; no model call')
  const kurz = scripted('Mail-Kurzbericht', null, { lifecycle: 'paused' })
  schedule(kurz, { kind: 'interval', seconds: 900 }, false)
  scripted('Daily action website', null, { lifecycle: 'paused', draft: true })
  scripted('Archived research', null, { lifecycle: 'archived' })

  // IURIO · DOCPIT mail: a paused bounded graph mirroring the Delta Mind network.
  const docpit = uuid()
  const docpitMembers = Object.entries(mailContracts).map(([name, contract]) => scripted(`IURIO · ${name}`, iurio, { contract, capabilities: name === 'Triage' ? ['jev.evaluate'] : [], lifecycle: 'paused' }))
  resource(docpitMembers[0]!, 'tool', 'pods-mail', program('pods-mail', [{ permission: 'pods-mail.account[email=patrick@docpit.eu].mail[*]#list', display: 'List mail for patrick@docpit.eu' }]))
  store.db.prepare('INSERT INTO workflows(id,revision,name,nodes,schedule,enabled,paused,mode,group_id) VALUES(?,1,?,?,NULL,0,1,\'channels\',?)').run(docpit, 'IURIO · DOCPIT mail management', JSON.stringify(docpitMembers.map(podId => ({ podId, after: [], handoff: false }))), iurio)
  for (const podId of docpitMembers) store.db.prepare('INSERT INTO workflow_members VALUES(?,?)').run(docpit, podId)
  for (const name of mailChannels) store.db.prepare('INSERT INTO workflow_channels VALUES(?,?,?,\'[]\')').run(docpit, name, name)
  for (const gate of [chooseGate, approveGate]) store.db.prepare('INSERT INTO workflow_gates VALUES(?,?,?)').run(docpit, gate.key, JSON.stringify(gate))

  // Linde: a paused cron chain reading five hosts and a paused bounded graph of five Pods.
  const report = scripted('Linde · Server report', linde, { lifecycle: 'paused' })
  for (const host of ['dev-portal.lindeverlag.at', 'portal-staging.lindeverlag.at', 'portal.lindeverlag.at', 'db.lindeverlag.at', 'weiloner.at']) resource(report, 'tool', host, ssh(host))
  resource(report, 'tool', 'https://api.telegram.org', http('https://api.telegram.org', ['POST']))
  const serverReport = uuid()
  store.db.prepare('INSERT INTO workflows(id,revision,name,nodes,schedule,enabled,paused,mode,group_id) VALUES(?,1,?,?,?,0,1,\'sequence\',?)').run(serverReport, 'Linde · Server report', JSON.stringify([{ podId: report, after: [], handoff: false }]), JSON.stringify({ kind: 'cron', expression: '0 8 * * 1,4', timezone: 'Europe/Vienna' }), linde)
  store.db.prepare('INSERT INTO workflow_members VALUES(?,?)').run(serverReport, report)
  const portal = uuid()
  const portalMembers = [['Portal · Issues', { takes: [], gives: ['portal.issue'], summary: 'Reads portal issues' }], ['Portal · Triage', { takes: ['portal.issue'], gives: ['portal.ready'], summary: 'Sorts portal issues' }], ['Portal · Report', { takes: ['portal.ready'], gives: [], summary: 'Reports portal work' }], ['Portal · Deploy check', { takes: [], gives: ['deploy.state'], summary: 'Reads deploy state' }], ['Portal · Deploy report', { takes: ['deploy.state'], gives: [], summary: 'Reports deploys' }]] as const
  const portalIds = portalMembers.map(([name, contract]) => scripted(name, linde, { contract: { ...contract, takes: [...contract.takes], gives: [...contract.gives] }, lifecycle: 'paused' }))
  store.db.prepare('INSERT INTO workflows(id,revision,name,nodes,schedule,enabled,paused,mode,group_id) VALUES(?,1,?,?,NULL,0,1,\'channels\',?)').run(portal, 'Linde · Portal development and systems', JSON.stringify(portalIds.map(podId => ({ podId, after: [], handoff: false }))), linde)
  for (const podId of portalIds) store.db.prepare('INSERT INTO workflow_members VALUES(?,?)').run(portal, podId)
  for (const name of ['portal.issue', 'portal.ready', 'deploy.state']) store.db.prepare('INSERT INTO workflow_channels VALUES(?,?,?,\'[]\')').run(portal, name, name)

  return { ...f, pods, network, briefing, docpit, serverReport, portal, groups: { deltaMind, iurio, linde } }
}
