import { describe, expect, it } from 'vitest'
import { attachTarget, eventsWindow, mapDriveChildren, stripHtml } from '../shared/graph-live'

describe('attachTarget', () => {
  it('rejects empty targets', () => {
    expect(attachTarget('', '')).toBeNull()
    expect(attachTarget(null, null)).toBeNull()
  })

  it('accepts a deal, a contact, or both', () => {
    expect(attachTarget('d1', '')).toEqual({ dealId: 'd1', contactId: null })
    expect(attachTarget('', 'c1')).toEqual({ dealId: null, contactId: 'c1' })
    expect(attachTarget('d1', 'c1')).toEqual({ dealId: 'd1', contactId: 'c1' })
  })
})

describe('stripHtml', () => {
  it('flattens tags to text', () => {
    expect(stripHtml('<p>Hallo <b>Welt</b></p>')).toBe('Hallo Welt')
  })
})

describe('mapDriveChildren', () => {
  it('marks folders and keeps web urls', () => {
    const rows = mapDriveChildren([
      { id: '1', name: 'Apps', folder: {}, webUrl: 'https://1', parentReference: { id: 'root' } },
      { id: '2', name: 'x.pdf', webUrl: 'https://2', size: 10 },
    ])
    expect(rows[0]).toMatchObject({ id: '1', folder: true, parent_id: 'root' })
    expect(rows[1]).toMatchObject({ id: '2', folder: false, size: 10 })
  })
})

describe('eventsWindow', () => {
  it('covers the next 60 days', () => {
    const now = new Date('2026-08-27T12:00:00Z')
    const win = eventsWindow(now)
    expect(win.start).toBe('2026-08-27T12:00:00.000Z')
    expect(new Date(win.end).getTime() - now.getTime()).toBe(60 * 24 * 60 * 60 * 1000)
  })
})
