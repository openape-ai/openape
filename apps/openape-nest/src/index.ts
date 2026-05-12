// OpenApe Nest daemon — Phase F (#sim-arch): pure long-running
// CLIENT, no inbound channel of any kind. Three responsibilities:
//
//   1. **pm2 supervisor**: each registered agent gets its own pm2-god
//      daemon (running as the agent's macOS uid) supervising one
//      `ape-agent` process. See lib/pm2-supervisor.ts.
//   2. **troop sync**: every 5 min walk the registry, run
//      `apes agents sync` for each. See lib/troop-sync.ts.
//   3. **registry watcher**: fs.watch on agents.json. When the
//      apes-cli writes a new entry (after `apes agents spawn`) or
//      drops one (after `apes agents destroy`), the Nest reconciles
//      its pm2 state automatically.
//
// No HTTP server, no intent-channel directory, no DDISA-grant
// gating of incoming calls. The apes-cli does its work directly
// via `apes run --as root -- apes agents spawn|destroy` and writes
// to the shared agents.json registry; the Nest just observes.
//
// Bootstrapped by `apes nest install`. Started + KeepAlive'd by
// launchd (one entry total — system-domain after migrate-to-service-
// user, user-domain otherwise).

import { watch } from 'node:fs'
import process from 'node:process'
import { listAgents, REGISTRY_PATH } from './lib/registry'
import { Pm2Supervisor } from './lib/pm2-supervisor'
import { TroopSync } from './lib/troop-sync'
import { readNestVersion, TroopWs } from './lib/troop-ws'

const APES_BIN = process.env.OPENAPE_APES_BIN ?? 'apes'
const RECONCILE_DEBOUNCE_MS = 1000

function log(line: string): void {
  process.stderr.write(`${new Date().toISOString()}  ${line}\n`)
}

const supervisor = new Pm2Supervisor({ apesBin: APES_BIN, log })
const troopSync = new TroopSync({ apesBin: APES_BIN, log })
const troopWs = new TroopWs({ apesBin: APES_BIN, log, version: readNestVersion() })

async function reconcile(): Promise<void> {
  try {
    await supervisor.reconcile(listAgents())
    log('nest: pm2-supervisor reconciled with registry')
  }
  catch (err) {
    log(`nest: reconcile failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

void reconcile()
troopSync.start()
troopWs.start()

// Watch the registry file for changes. fs.watch fires once per
// "something happened" — debounce with a small timer because some
// editors / atomic-rename writes fire two events in quick
// succession (rename: old, rename: new).
let reconcileTimer: NodeJS.Timeout | undefined
try {
  watch(REGISTRY_PATH, () => {
    if (reconcileTimer) clearTimeout(reconcileTimer)
    reconcileTimer = setTimeout(() => { void reconcile() }, RECONCILE_DEBOUNCE_MS)
  })
  log(`nest: watching ${REGISTRY_PATH} for registry changes`)
}
catch (err) {
  log(`nest: registry watch failed (${err instanceof Error ? err.message : String(err)}) — falling back to 5s poll`)
  setInterval(() => { void reconcile() }, 5_000).unref()
}

process.on('SIGTERM', () => {
  log('nest: SIGTERM — stopping')
  troopSync.stop()
  troopWs.stop()
  if (reconcileTimer) clearTimeout(reconcileTimer)
  process.exit(0)
})

process.on('SIGINT', () => {
  log('nest: SIGINT — stopping')
  troopSync.stop()
  troopWs.stop()
  if (reconcileTimer) clearTimeout(reconcileTimer)
  process.exit(0)
})
