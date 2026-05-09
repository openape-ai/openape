import { describe, expect, it } from 'vitest'
import { buildSyncPlist, syncPlistLabel, syncPlistPath } from '../src/lib/troop-bootstrap'

describe('troop-bootstrap', () => {
  it('label + path follow the openape.troop.sync.<agent> convention', () => {
    expect(syncPlistLabel('alice')).toBe('openape.troop.sync.alice')
    // Plist lives in /Library/LaunchDaemons (system domain) — hidden
    // service accounts have no per-user launchd domain to bootstrap into.
    expect(syncPlistPath('/Users/alice', 'alice'))
      .toBe('/Library/LaunchDaemons/openape.troop.sync.alice.plist')
  })

  it('plist body includes the agents-sync invocation, RunAtLoad, 5min interval, no UserName (runs as root)', () => {
    const body = buildSyncPlist({
      agentName: 'alice',
      apesBin: '/usr/local/bin/apes',
      homeDir: '/Users/alice',
      userName: 'alice',
    })
    expect(body).toContain('<string>openape.troop.sync.alice</string>')
    expect(body).toContain('<string>/usr/local/bin/apes</string>')
    expect(body).toContain('<string>agents</string>')
    expect(body).toContain('<string>sync</string>')
    expect(body).toContain('<key>StartInterval</key>')
    expect(body).toContain('<integer>300</integer>')
    expect(body).toContain('<key>RunAtLoad</key>')
    expect(body).toContain('<true/>')
    expect(body).toContain('<key>HOME</key><string>/Users/alice</string>')
    // No UserName — sync runs as ROOT so it can write
    // /Library/LaunchDaemons/ and `launchctl bootstrap system` task
    // plists. It chowns its writes back to the agent uid via stat($HOME).
    expect(body).not.toContain('<key>UserName</key>')
    // PATH must include common node/bun locations so the apes binary's
    // `#!/usr/bin/env node` shebang resolves.
    expect(body).toContain('<key>PATH</key>')
    expect(body).toContain('/Users/alice/.bun/bin')
    expect(body).toContain('/opt/homebrew/bin')
    // Sync (as root) reads AGENT_USER to plumb into the per-task plist
    // UserName key so each task daemon runs as the agent.
    expect(body).toContain('<key>AGENT_USER</key>')
    expect(body).toContain('<string>alice</string>')
  })

  it('passes through OPENAPE_TROOP_URL when supplied (staging)', () => {
    const body = buildSyncPlist({
      agentName: 'alice',
      apesBin: '/usr/local/bin/apes',
      homeDir: '/Users/alice',
      userName: 'alice',
      troopUrl: 'https://staging.troop.openape.ai',
    })
    expect(body).toContain('<key>OPENAPE_TROOP_URL</key>')
    expect(body).toContain('<string>https://staging.troop.openape.ai</string>')
  })

  it('escapes XML metacharacters in the agent name', () => {
    const body = buildSyncPlist({
      agentName: 'a&b',
      apesBin: '/usr/local/bin/apes',
      homeDir: '/Users/alice',
      userName: 'a&b',
    })
    expect(body).toContain('a&amp;b')
    expect(body).not.toContain('a&b<')
  })
})
