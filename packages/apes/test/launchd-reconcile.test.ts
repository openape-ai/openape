import { describe, expect, it } from 'vitest'
import { _internal } from '../src/lib/launchd-reconcile'

const { cronToSchedule, buildPlistContent } = _internal

describe('cronToSchedule', () => {
  it('* * * * * → one slot with no fields (launchd "every minute")', () => {
    expect(cronToSchedule('* * * * *')).toEqual([{}])
  })

  it('0 18 * * * → fires every day at 18:00', () => {
    expect(cronToSchedule('0 18 * * *')).toEqual([{ Minute: 0, Hour: 18 }])
  })

  it('*/15 * * * * → expands to 4 slots (0/15/30/45)', () => {
    const slots = cronToSchedule('*/15 * * * *')
    expect(slots).toHaveLength(4)
    expect(slots.map(s => s.Minute)).toEqual([0, 15, 30, 45])
  })

  it('0 */6 * * * → 4 slots at 0/6/12/18 with Minute=0', () => {
    const slots = cronToSchedule('0 */6 * * *')
    expect(slots).toHaveLength(4)
    expect(slots.every(s => s.Minute === 0)).toBe(true)
    expect(slots.map(s => s.Hour)).toEqual([0, 6, 12, 18])
  })

  it('Sunday=7 in cron is normalized to launchd Weekday=0', () => {
    const slots = cronToSchedule('0 9 * * 7')
    expect(slots).toEqual([{ Minute: 0, Hour: 9, Weekday: 0 }])
  })
})

describe('buildPlistContent', () => {
  it('renders a valid plist body for a simple task', () => {
    const body = buildPlistContent({
      agentName: 'alice',
      apesBin: '/usr/local/bin/apes',
      homeDir: '/Users/alice',
      task: {
        agentEmail: 'agent+alice+example.com@id.openape.ai',
        taskId: 'mail-triage',
        name: 'Mail Triage',
        cron: '*/15 * * * *',
        userPrompt: 'do the thing',
        tools: ['mail.list'],
        maxSteps: 10,
        enabled: true,
        createdAt: 0,
        updatedAt: 0,
      },
    })
    expect(body).toContain('<key>Label</key>')
    expect(body).toContain('<string>openape.troop.alice.mail-triage</string>')
    expect(body).toContain('<string>/usr/local/bin/apes</string>')
    expect(body).toContain('<string>agents</string>')
    expect(body).toContain('<string>run</string>')
    expect(body).toContain('<string>mail-triage</string>')
    expect(body).toContain('<string>/Users/alice</string>')
    // Multi-slot cron → array (not single dict)
    expect(body).toContain('<array>')
  })

  it('escapes < and & in identifiers', () => {
    const body = buildPlistContent({
      agentName: 'alice',
      apesBin: '/usr/local/bin/apes',
      homeDir: '/Users/alice',
      task: {
        agentEmail: 'agent+alice+example.com@id.openape.ai',
        taskId: 'foo&bar',
        name: 'x',
        cron: '* * * * *',
        userPrompt: 'do the thing',
        tools: [],
        maxSteps: 5,
        enabled: true,
        createdAt: 0,
        updatedAt: 0,
      },
    })
    expect(body).toContain('foo&amp;bar')
    expect(body).not.toContain('foo&bar')
  })
})
