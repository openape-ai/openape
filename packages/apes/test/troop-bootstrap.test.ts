import { describe, expect, it } from 'vitest'
import { buildSyncPlist, syncPlistLabel, syncPlistPath } from '../src/lib/troop-bootstrap'

describe('troop-bootstrap', () => {
  it('label + path follow the openape.troop.sync.<agent> convention', () => {
    expect(syncPlistLabel('alice')).toBe('openape.troop.sync.alice')
    expect(syncPlistPath('/Users/alice', 'alice'))
      .toBe('/Users/alice/Library/LaunchAgents/openape.troop.sync.alice.plist')
  })

  it('plist body includes the agents-sync invocation, RunAtLoad, 5min interval', () => {
    const body = buildSyncPlist({
      agentName: 'alice',
      apesBin: '/usr/local/bin/apes',
      homeDir: '/Users/alice',
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
  })

  it('passes through OPENAPE_TROOP_URL when supplied (staging)', () => {
    const body = buildSyncPlist({
      agentName: 'alice',
      apesBin: '/usr/local/bin/apes',
      homeDir: '/Users/alice',
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
    })
    expect(body).toContain('a&amp;b')
    expect(body).not.toContain('a&b<')
  })
})
