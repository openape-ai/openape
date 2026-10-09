import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { canonicalNetworkJson } from '../../contracts/network-json.ts'

// Storage stays importable by plain Node without the contract parsers; the runtime parses every upgraded definition strictly on read.
const currentFormat = 6
const legacyFormats = [1, 2, 3, 4, 5]
interface LegacyGate { key: string, title: string, podId: string, channel: string }
interface LegacyRoute { key: string, title: string, kind: string, takes: string, gives?: string }
interface LegacyDefinition { formatVersion: number, id: string, revision: number, members: { podId: string, contract: { takes: string[] } }[], gates?: LegacyGate[], routes?: LegacyRoute[], joins?: unknown[], feedback?: unknown[] }

/**
 * Upgrades one stored definition of formats 1 to 5. Those formats stored every approval twice: as a gate binding
 * `{key,title,kind:'approve',podId,channel}` and, since format 5, as the approve route that the binding had to match.
 * The route alone carries the same facts: its one consumer of `gives` is the gated Pod and `takes` the held channel.
 * A binding without such a route held a consumer's own input; the current format cannot express that, so the upgrade
 * refuses it instead of dropping an owner approval.
 */
export function upgradeNetworkDefinition(stored: LegacyDefinition): Record<string, unknown> {
  const { gates = [], routes = [], joins = [], feedback = [], ...definition } = stored
  if (!legacyFormats.includes(definition.formatVersion)) throw new Error(`Unsupported stored network format ${String(definition.formatVersion)}`)
  const approvals = routes.flatMap(route => route.kind === 'approve' ? [{ ...route, podIds: definition.members.filter(member => member.contract.takes.includes(route.gives!)).map(member => member.podId) }] : [])
  const routed = gates.every(gate => approvals.some(route => route.key === gate.key && route.title === gate.title && route.takes === gate.channel && route.podIds.length === 1 && route.podIds[0] === gate.podId))
  if (!routed || approvals.length !== gates.length) throw new Error(`Network ${definition.id} revision ${definition.revision} holds an approval gate without its route; restore the previous version of OpenApe Pods`)
  return { ...definition, formatVersion: currentFormat, routes, joins, feedback }
}

/** Rewrites every stored network revision into the current format; pending batches, choices and traces keep their keys. */
export function upgradeStoredNetworkDefinitions(database: DatabaseSync): number {
  const rows = database.prepare('SELECT network_id,revision,contract FROM network_revisions ORDER BY network_id,revision').all()
  const update = database.prepare('UPDATE network_revisions SET contract=?,content_hash=? WHERE network_id=? AND revision=?')
  for (const row of rows) {
    const body = canonicalNetworkJson(upgradeNetworkDefinition(JSON.parse(String(row.contract)) as LegacyDefinition))
    update.run(body, createHash('sha256').update(body).digest('hex'), row.network_id!, row.revision!)
  }
  return rows.length
}
