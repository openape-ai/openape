// OpenApe Nest daemon — local control-plane that hosts agents on this
// computer. Phase D (#sim-arch) makes the Nest a pure long-running
// CLIENT: no HTTP server bound to a port, no DDISA-grant gating of an
// inbound API. Three responsibilities:
//
//   1. Supervisor: one chat-bridge child per registered agent
//      (`apes run --as <agent> --wait -- openape-chat-bridge`),
//      restart with backoff. See lib/supervisor.ts.
//   2. Troop sync: every 5 min, walk the registry and run
//      `apes agents sync` for each agent. See lib/troop-sync.ts.
//   3. Intent channel: poll `~/intents/*.json` for control commands
//      (spawn / destroy / list) dropped by the apes-cli, execute,
//      write `<id>.response` back. See lib/intent-channel.ts.
//
// Dir-based intent transport instead of HTTP because (a) the Nest
// stays a client (no listening socket), (b) UNIX permissions on the
// shared dir gate access (mode 770, group _openape_nest), (c) no
// per-call DDISA grant burn (which was unworkable since humans have
// no YOLO and would have re-approved on every spawn).
//
// Bootstrapped by `apes nest install`. Started + KeepAlive'd by
// launchd (one entry total — system-domain after migrate-to-service-
// user, user-domain otherwise).

import process from 'node:process'
import { IntentChannel, reapStaleResponses } from './lib/intent-channel'
import { listAgents } from './lib/registry'
import { Supervisor } from './lib/supervisor'
import { TroopSync } from './lib/troop-sync'

const APES_BIN = process.env.OPENAPE_APES_BIN ?? 'apes'

function log(line: string): void {
  process.stderr.write(`${new Date().toISOString()}  ${line}\n`)
}

const supervisor = new Supervisor({ apesBin: APES_BIN, log })
const troopSync = new TroopSync({ apesBin: APES_BIN, log })
const intentChannel = new IntentChannel({ apesBin: APES_BIN, supervisor, log })

// Reconcile from the persisted registry on boot — re-spawns the
// chat-bridge child for every agent that was registered before the
// last daemon shutdown.
supervisor.reconcile(listAgents())
log(`nest: supervisor reconciled, ${supervisor.size()} bridge process(es) starting`)

troopSync.start()
intentChannel.start()

// Reap stale response files every hour.
const reaperTimer = setInterval(reapStaleResponses, 60 * 60 * 1000, log)

process.on('SIGTERM', () => {
  log('nest: SIGTERM — stopping')
  supervisor.stopAll()
  troopSync.stop()
  intentChannel.stop()
  clearInterval(reaperTimer)
  process.exit(0)
})

process.on('SIGINT', () => {
  log('nest: SIGINT — stopping')
  supervisor.stopAll()
  troopSync.stop()
  intentChannel.stop()
  clearInterval(reaperTimer)
  process.exit(0)
})
