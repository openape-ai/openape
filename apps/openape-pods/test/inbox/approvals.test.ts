import { expect, it } from 'vitest'
import { countPendingGrants } from '../../src/main/inbox/approvals'

const grant = (id: string, requester: string, status = 'pending', batch?: string) => ({ id, status, request: { requester, ...(batch ? { batch: { id: batch } } : {}) } })

it('counts what apes grants inbox lists, one approval per batch', () => {
  const page = { data: [
    grant('g1', 'pod-a@pods.openape.ai', 'pending', 'b1'),
    grant('g2', 'pod-a@pods.openape.ai', 'pending', 'b1'),
    grant('g3', 'pod-b@pods.openape.ai', 'pending', 'b1'),
    grant('g4', 'agent@id.openape.ai'),
    grant('g5', 'Owner@Example.com'),
    grant('g6', 'agent@id.openape.ai', 'approved'),
  ] }
  // One batch per requester, one single grant; the owner's own request and decided grants do not count.
  expect(countPendingGrants(page, 'owner@example.com')).toBe(3)
  expect(() => countPendingGrants({}, 'owner@example.com')).toThrow('Invalid IdP grant listing')
})
