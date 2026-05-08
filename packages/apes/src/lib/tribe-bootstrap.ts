// Tribe-side spawn integration. Installs the periodic sync launchd
// plist for a freshly spawned agent and bootstraps it into the
// agent's user-domain so it kicks off immediately.
//
// The sync plist runs `apes agents sync` every 5 minutes (StartInterval).
// It also fires once on bootstrap (the implicit launchctl bootstrap
// run) so the agent's first appearance in the tribe SP UI doesn't
// have to wait a full sync cycle after spawn finishes.

const SYNC_LABEL_PREFIX = 'openape.tribe.sync'
const SYNC_INTERVAL_SECONDS = 300

export function syncPlistLabel(agentName: string): string {
  return `${SYNC_LABEL_PREFIX}.${agentName}`
}

export function syncPlistPath(homeDir: string, agentName: string): string {
  return `${homeDir}/Library/LaunchAgents/${syncPlistLabel(agentName)}.plist`
}

interface SyncPlistInput {
  agentName: string
  apesBin: string
  homeDir: string
  // Optional override for OPENAPE_TRIBE_URL — exposed in the plist
  // EnvironmentVariables so the launchd-spawned `apes agents sync`
  // talks to the right SP. Default: https://tribe.openape.ai (via
  // the apes binary's resolveTribeUrl). Useful for testing against
  // a staging tribe.
  tribeUrl?: string
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function buildSyncPlist(input: SyncPlistInput): string {
  const envBlock = input.tribeUrl
    ? `  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${escape(input.homeDir)}</string>
    <key>OPENAPE_TRIBE_URL</key><string>${escape(input.tribeUrl)}</string>
  </dict>
`
    : `  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${escape(input.homeDir)}</string>
  </dict>
`

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escape(syncPlistLabel(input.agentName))}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escape(input.apesBin)}</string>
    <string>agents</string>
    <string>sync</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escape(input.homeDir)}</string>
${envBlock}  <key>StartInterval</key>
  <integer>${SYNC_INTERVAL_SECONDS}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escape(input.homeDir)}/Library/Logs/openape-tribe-sync.log</string>
  <key>StandardErrorPath</key>
  <string>${escape(input.homeDir)}/Library/Logs/openape-tribe-sync.log</string>
</dict>
</plist>
`
}

export const _internal = { SYNC_INTERVAL_SECONDS, SYNC_LABEL_PREFIX }
