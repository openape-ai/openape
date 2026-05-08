import { describe, expect, it } from 'vitest'
import { buildSyncPlist, syncPlistLabel, syncPlistPath } from '../src/lib/tribe-bootstrap'

describe('tribe-bootstrap', () => {
  it('label + path follow the openape.tribe.sync.<agent> convention', () => {
    expect(syncPlistLabel('alice')).toBe('openape.tribe.sync.alice')
    expect(syncPlistPath('/Users/alice', 'alice'))
      .toBe('/Users/alice/Library/LaunchAgents/openape.tribe.sync.alice.plist')
  })

  it('plist body includes the agents-sync invocation, RunAtLoad, 5min interval', () => {
    const body = buildSyncPlist({
      agentName: 'alice',
      apesBin: '/usr/local/bin/apes',
      homeDir: '/Users/alice',
    })
    expect(body).toContain('<string>openape.tribe.sync.alice</string>')
    expect(body).toContain('<string>/usr/local/bin/apes</string>')
    expect(body).toContain('<string>agents</string>')
    expect(body).toContain('<string>sync</string>')
    expect(body).toContain('<key>StartInterval</key>')
    expect(body).toContain('<integer>300</integer>')
    expect(body).toContain('<key>RunAtLoad</key>')
    expect(body).toContain('<true/>')
    expect(body).toContain('<key>HOME</key><string>/Users/alice</string>')
  })

  it('passes through OPENAPE_TRIBE_URL when supplied (staging)', () => {
    const body = buildSyncPlist({
      agentName: 'alice',
      apesBin: '/usr/local/bin/apes',
      homeDir: '/Users/alice',
      tribeUrl: 'https://staging.tribe.openape.ai',
    })
    expect(body).toContain('<key>OPENAPE_TRIBE_URL</key>')
    expect(body).toContain('<string>https://staging.tribe.openape.ai</string>')
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
