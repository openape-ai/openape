import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { choiceEvents } from '../renderer/choice-events'
import type { ScheduleSpec } from '../../src/contracts/scheduling'
import { installExample } from '../../src/worker/runs/examples'
import { ItemTagStore } from '../../src/worker/workspace/item-tags'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { digest, PodDatabase } from '../../src/worker/storage/database'

export { choiceEvents }

/**
 * A synthetic profile shaped like the installed one after the conversions of issues 1465 and 1468: 30 Pods
 * tagged delta-mind, iurio and linde (the former groups) plus Pods without a tag; seven autonomous mail Pods and
 * the four Morgenbriefing Pods that share data through namespaces, open owner questions and
 * approvals, and standalone monitors. No row carries a secret value. `NOW` is the snapshot time.
 */
export const NOW = 1791284728000
const HOUR = 3600000
const hash = 'a'.repeat(64)
const uuid = () => randomUUID()

const o365 = (account: string, displays: string[]) => ({ type: 'program', stateId: uuid(), capability: `tool.app_${uuid().replaceAll('-', '')}.invoke`, cliId: 'o365-cli', name: 'o365-cli', executable: 'o365-cli', executableHash: hash, adapterPath: '/unused', adapterHash: hash, networkHosts: [], entryFiles: [], environment: {}, grants: displays.map(display => ({ permission: `o365.account[email=${account}].mail[*]#${display.startsWith('Move') ? 'move' : 'list'}`, display })) })
const program = (cliId: string, grants: { permission: string, display: string }[]) => ({ type: 'program', stateId: uuid(), capability: `tool.app_${uuid().replaceAll('-', '')}.invoke`, cliId, name: cliId, executable: cliId, executableHash: hash, adapterPath: '/unused', adapterHash: hash, networkHosts: [], entryFiles: [], environment: {}, grants })
const http = (origin: string, methods: string[]) => ({ type: 'http', origin, methods, capability: `tool.http_${uuid().replaceAll('-', '')}.request` })
const directory = (path: string, access: 'read' | 'readWrite') => ({ path, access, device: '1', inode: '1' })
const credential = (alias: string) => ({ alias, credentialId: uuid() })
const jev = { type: 'jev', capability: 'jev.evaluate', connectionId: uuid(), model: 'jev-1.13.0', maxAttempts: 20, authority: {} }
const ssh = (alias: string) => ({ type: 'sshInventory', target: { alias, jumps: [], profile: 'linde-server-v1' }, hosts: [alias], knownHosts: '', profileHash: hash, authority: {}, capability: `tool.ssh_${uuid().replaceAll('-', '')}.read` })

export const mailPods = ['Mail-Synchronisierung', 'Mail-Klassifizierung', 'Mail-Übersicht', 'Rechnungsprüfung', 'Antwortvorbereitung', 'Newsletter-Prüfung', 'Wissensvorschläge'] as const
const roots: string[] = []
const stores: PodDatabase[] = []
export function closeMapFixtures(): void {
  for (const store of stores.splice(0)) store.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

export function mapFixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-map-')); roots.push(root)
  const store = new PodDatabase(root); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  const tags = new ItemTagStore(store)
  const deltaMind = 'delta-mind'; const iurio = 'iurio'; const linde = 'linde'
  const pods: Record<string, string> = {}

  // Program grants are Pod grants in the ledger, apart from the sandbox entry of the application.
  const resource = (podId: string, kind: string, name: string, { grants, ...configuration }: Record<string, unknown>) => {
    store.db.prepare('INSERT INTO resources VALUES(?,?,1,?,\'ready\',?,?)').run(uuid(), podId, kind, name, JSON.stringify(configuration))
    for (const grant of (grants ?? []) as { permission: string, display: string }[]) store.db.prepare('INSERT INTO pod_grants VALUES(?,?,?,?,?,?,?,\'always\',\'approved\',0,?,?)').run(uuid(), podId, 'https://id.example.invalid', `pod-${podId}`, String(configuration.cliId), JSON.stringify([{ type: 'openape_cli', cli_id: configuration.cliId, operation_id: '*', resource_chain: [], action: grant.permission.split('#')[1], permission: grant.permission, display: grant.display, risk: 'low' }]), grant.display, NOW, NOW)
  }
  const scripted = (name: string, tag: string | null, options: { capabilities?: string[], lifecycle?: 'active' | 'paused' | 'archived', draft?: boolean } = {}) => {
    const pod = store.createPod({ name })
    if (tag) tags.execute({ type: 'tag', id: pod.id, revision: 0, tags: [tag] })
    if (!options.draft) {
      installExample(store, resources, pod.id, 'deterministic', hash)
      const manifest = JSON.parse(store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=?').get(pod.id)!.manifest as string)
      const code = `export async function run() { return { status: 'completed', summary: 'fixture', completedInputIds: [], gapIds: [] } }\n`
      const scriptHash = digest(code)
      store.storeScript(pod.id, { ...manifest, contentHash: scriptHash, capabilities: options.capabilities ?? [] }, code)
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

  // Delta Mind mail: seven autonomous Pods that share data; Mail-Synchronisierung reads the mailbox every 15 minutes.
  const sync = scripted('Mail-Synchronisierung', deltaMind)
  const classification = scripted('Mail-Klassifizierung', deltaMind, { capabilities: ['jev.evaluate'] })
  const overview = scripted('Mail-Übersicht', deltaMind, { })
  const invoices = scripted('Rechnungsprüfung', deltaMind, { })
  const replies = scripted('Antwortvorbereitung', deltaMind, { })
  const newsletters = scripted('Newsletter-Prüfung', deltaMind, { })
  const knowledge = scripted('Wissensvorschläge', deltaMind, { })
  for (const podId of [sync, classification, overview, invoices, replies, newsletters, knowledge]) store.db.prepare('INSERT INTO local_only_pods VALUES(?)').run(podId)
  schedule(sync, { kind: 'interval', seconds: 900 }, true)
  resource(sync, 'tool', 'o365-cli', o365('phofmann@delta-mind.at', ['List emails in inbox for phofmann@delta-mind.at', 'Read email from account phofmann@delta-mind.at']))
  resource(sync, 'directory', 'delta', directory('/Users/fixture/Pods/delta', 'readWrite'))
  resource(classification, 'tool', 'TypeSafe / Jev', jev)
  resource(classification, 'directory', 'delta', directory('/Users/fixture/Pods/delta', 'readWrite'))
  resource(newsletters, 'tool', 'o365-cli', o365('phofmann@delta-mind.at', ['Move approved mail for phofmann@delta-mind.at']))
  const batch = uuid()
  store.db.prepare('INSERT INTO approval_batches VALUES(?,?,\'Newsletter archive\',?,\'https://id.example.invalid/grant-batch\',?,0,NULL,?)').run(batch, newsletters, NOW + 7 * 24 * HOUR, NOW, NOW)
  for (let index = 0; index < 4; index++) store.db.prepare('INSERT INTO action_approvals(id,pod_id,action,object,payload,payload_hash,title,authority,batch_id,state,created_at,updated_at) VALUES(?,?,\'mail.archive\',?,\'{}\',?,?,\'{}\',?,\'requested\',?,?)').run(uuid(), newsletters, `phofmann@delta-mind.at:n${index}`, digest(`n${index}`), `Archive mail from news${index}@example.com`, batch, NOW, NOW)
  for (const podId of [sync, classification]) {
    for (let index = 0; index < 10; index++) run(podId, NOW - HOUR - index * 900000, 'completed', `${store.getPod(podId).name} completed`)
  }
  store.db.prepare('UPDATE runs SET summary=\'Read 6 changed messages. No mailbox writes.\' WHERE pod_id=? AND started_at=(SELECT max(started_at) FROM runs WHERE pod_id=?)').run(sync, sync)

  // Morgenbriefing: four Pods without a tag that share the briefing data.
  const mp = scripted('Mail-Prüfung · Morgenbriefing', null, { capabilities: ['jev.evaluate'] })
  resource(mp, 'tool', 'pods-mail', program('pods-mail', [{ permission: 'pods-mail.account[email=phofmann@delta-mind.at].mail[*]#list', display: 'List mail for phofmann@delta-mind.at' }, { permission: 'pods-mail.account[email=patrick@docpit.eu].mail[*]#list', display: 'List mail for patrick@docpit.eu' }]))
  resource(mp, 'directory', 'mail', directory('/Users/fixture/Briefing Evidence/mail', 'readWrite'))
  schedule(mp, { kind: 'daily', time: '06:00', timezone: 'Europe/Vienna' }, true)
  const ki = scripted('Morgenbriefing · Kalender und Issues', null, { })
  resource(ki, 'tool', 'o365-cli', o365('phofmann@delta-mind.at', ['Read today calendar for phofmann@delta-mind.at']))
  resource(ki, 'tool', 'repos-issues', program('repos-issues', [{ permission: 'repos-issues.issue[*]#list', display: 'Read open issues' }]))
  const red = scripted('Morgenbriefing · Redaktion', null, { })
  resource(red, 'directory', 'mail', directory('/Users/fixture/Briefing Evidence/mail', 'read'))
  const bot = scripted('Morgenbriefing · Calendar-Bot', null, { })
  resource(bot, 'tool', 'https://api.telegram.org', http('https://api.telegram.org', ['GET', 'POST']))
  resource(bot, 'tool', 'https://report.openape.ai', http('https://report.openape.ai', ['GET', 'POST']))
  resource(bot, 'credential', 'calendar_bot_token', credential('calendar_bot_token'))
  resource(bot, 'credential', 'reports_publisher_key', credential('reports_publisher_key'))
  run(mp, NOW - 6 * HOUR, 'completed', 'Mail review collected for 2026-10-06')
  for (const [podId, summary] of [[ki, 'Calendar and issue sources collected for 2026-10-06'], [red, 'German editorial report ready for 2026-10-06'], [bot, 'Report published for 2026-10-06']] as const) run(podId, NOW - 6 * HOUR, 'completed', summary, podId === bot ? 2 : 0)
  // One delivery of the bot never got its answer: the owner reconciles it in Entscheidungen.
  store.db.prepare('UPDATE effect_ledger SET state=\'unknown\' WHERE pod_id=? AND rowid=(SELECT min(rowid) FROM effect_ledger WHERE pod_id=?)').run(bot, bot)

  // Standalone monitors tagged iurio and without a tag.
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

  // IURIO · DOCPIT mail: paused Pods that read no shared data yet.
  const docpit = mailPods.map(name => scripted(`IURIO · ${name}`, iurio, { capabilities: name === 'Mail-Klassifizierung' ? ['jev.evaluate'] : [], lifecycle: 'paused' }))
  resource(docpit[0]!, 'tool', 'pods-mail', program('pods-mail', [{ permission: 'pods-mail.account[email=patrick@docpit.eu].mail[*]#list', display: 'List mail for patrick@docpit.eu' }]))

  // Linde: a paused Pod reading five hosts and five paused portal Pods.
  const report = scripted('Linde · Server report', linde, { lifecycle: 'paused' })
  for (const host of ['dev-portal.lindeverlag.at', 'portal-staging.lindeverlag.at', 'portal.lindeverlag.at', 'db.lindeverlag.at', 'weiloner.at']) resource(report, 'tool', host, ssh(host))
  resource(report, 'tool', 'https://api.telegram.org', http('https://api.telegram.org', ['POST']))
  for (const name of ['Portal · Issues', 'Portal · Triage', 'Portal · Report', 'Portal · Deploy check', 'Portal · Deploy report']) scripted(name, linde, { lifecycle: 'paused' })

  return { store, resources, pods, tags: { deltaMind, iurio, linde } }
}
