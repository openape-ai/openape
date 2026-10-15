import { expect, it } from 'vitest'
import { countPendingGrants } from '../../src/main/inbox/approvals'

const grant = (id: string, requester: string, status = 'pending', batch?: string, waits = 2000) => ({ id, status, request: { requester, waits_until: waits, ...(batch ? { batch: { id: batch } } : {}) } })

it('counts what apes grants inbox lists, one approval per batch', () => {
  const page = {
    data: [
      grant('g1', 'pod-a@pods.openape.ai', 'pending', 'b1'),
      grant('g2', 'pod-a@pods.openape.ai', 'pending', 'b1'),
      grant('g3', 'pod-b@pods.openape.ai', 'pending', 'b1'),
      grant('g4', 'agent@id.openape.ai'),
      grant('g5', 'Owner@Example.com'),
      grant('g6', 'agent@id.openape.ai', 'approved'),
      grant('g7', 'pod-c@pods.openape.ai', 'pending', 'old', 900),
    ],
  }
  // One batch per requester, one single grant; the owner's own request, decided grants and requests nobody waits for do not count.
  expect(countPendingGrants(page, 'owner@example.com', 1000)).toBe(3)
  expect(() => countPendingGrants({}, 'owner@example.com')).toThrow('Invalid IdP grant listing')
})
