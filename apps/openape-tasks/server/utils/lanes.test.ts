import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LANES,
  DEV_WORKFLOW_LANES,
  doneLaneId,
  effectiveLaneId,
  laneById,
  laneForStatus,
  resolveLanes,
  validateLanes,
  type Lane,
} from './lanes'

const dev: Lane[] = validateLanes(DEV_WORKFLOW_LANES)
const [backlog, ready, doing, review, done] = dev

describe('validateLanes', () => {
  it('accepts a valid set and mints ids', () => {
    expect(dev).toHaveLength(5)
    expect(dev.every(l => typeof l.id === 'string' && l.id.length > 0)).toBe(true)
  })

  it('preserves a client-supplied id (keeps task.lane_id stable on rename)', () => {
    const out = validateLanes([
      { id: 'keep-me', name: 'Todo', status: 'open' },
      { name: 'Done', status: 'done' },
    ])
    expect(out[0]!.id).toBe('keep-me')
  })

  it('rejects bad shapes', () => {
    expect(() => validateLanes('nope')).toThrow()
    expect(() => validateLanes([])).toThrow()
    expect(() => validateLanes([{ name: 'A', status: 'open' }, { name: 'a', status: 'done' }])).toThrow(/duplicate/)
    expect(() => validateLanes([{ name: 'X', status: 'bogus' }])).toThrow()
    expect(() => validateLanes([{ name: 'Only', status: 'doing' }])).toThrow(/open/)
    expect(() => validateLanes([{ name: 'Only', status: 'open' }])).toThrow(/done/)
    expect(() => validateLanes(Array.from({ length: 13 }, (_, i) => ({ name: `L${i}`, status: 'open' })))).toThrow()
  })
})

describe('resolveLanes', () => {
  it('falls back to defaults for null / malformed', () => {
    expect(resolveLanes(null)).toEqual(DEFAULT_LANES)
    expect(resolveLanes('{not json')).toEqual(DEFAULT_LANES)
    expect(resolveLanes('[]')).toEqual(DEFAULT_LANES)
  })

  it('parses a stored set', () => {
    expect(resolveLanes(JSON.stringify(dev))).toHaveLength(5)
  })
})

describe('effectiveLaneId', () => {
  it('keeps a still-valid lane', () => {
    expect(effectiveLaneId(dev, 'open', ready!.id)).toBe(ready!.id)
  })

  it('falls a NULL lane into the first lane of its bucket', () => {
    expect(effectiveLaneId(dev, 'open', null)).toBe(backlog!.id)
    expect(effectiveLaneId(dev, 'doing', null)).toBe(doing!.id)
  })

  it('maps archived to a done lane for stable display', () => {
    expect(effectiveLaneId(dev, 'archived', null)).toBe(done!.id)
  })
})

describe('laneForStatus (status change without explicit lane move)', () => {
  it('moves a Review (doing) task to the done lane when marked done', () => {
    expect(laneForStatus(dev, 'done', review!.id)).toBe(done!.id)
  })

  it('keeps the current lane if its bucket already matches', () => {
    // Ready is open; setting status=open must not yank it to Backlog.
    expect(laneForStatus(dev, 'open', ready!.id)).toBe(ready!.id)
  })

  it('snaps to the first lane of the bucket on a cross-bucket change', () => {
    expect(laneForStatus(dev, 'open', done!.id)).toBe(backlog!.id)
  })
})

describe('laneById', () => {
  it('resolves by id and case-insensitive name', () => {
    expect(laneById(dev, ready!.id)?.id).toBe(ready!.id)
    expect(laneById(dev, 'ready')?.id).toBe(ready!.id)
    expect(laneById(dev, 'REVIEW')?.id).toBe(review!.id)
    expect(laneById(dev, 'nope')).toBeUndefined()
  })
})

describe('doneLaneId', () => {
  it('returns the rightmost done lane', () => {
    const twoDone = validateLanes([
      { name: 'Todo', status: 'open' },
      { name: 'Done', status: 'done' },
      { name: 'Archived-ish', status: 'done' },
    ])
    expect(doneLaneId(twoDone)).toBe(twoDone[2]!.id)
  })
})
