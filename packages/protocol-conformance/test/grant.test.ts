import type { OpenApeGrant } from '@openape/core'
import { approveGrant, createGrant, grantReferenceKey, InMemoryGrantStore, parseGrantSummary, withdrawReferencedGrant } from '@openape/grants'
import { describe, expect, it } from 'vitest'
import { getValidator } from './harness.js'

describe('grant object — grant.json', () => {
  const { validate } = getValidator('grant.json')

  it('approved command grant validates against schema', async () => {
    const store = new InMemoryGrantStore()
    const grant = await createGrant(
      {
        requester: 'agent@example.com',
        target_host: 'macmini.local',
        audience: 'apes',
        grant_type: 'once',
        permissions: ['read'],
      },
      store,
    )
    const approved = await approveGrant(grant.id, 'admin@example.com', store)
    const { valid, errors } = validate(approved)
    expect(valid, `Schema errors:\n${errors}`).toBe(true)
  })

  it('withdrawn referenced grant validates against schema (issue 1536)', async () => {
    const store = new InMemoryGrantStore()
    const request = { requester: 'agent@example.com', target_host: 'macmini.local', audience: 'shapes', grant_type: 'once' as const, command: ['o365-cli', 'workflow', 'archive'], reference: 'archive-v2:abc' }
    const { grant } = await store.createReferenced({ id: crypto.randomUUID(), type: 'command', request, status: 'pending', created_at: Math.floor(Date.now() / 1000) })
    await withdrawReferencedGrant(grantReferenceKey(request.requester, request.reference), 'Mail left the Inbox', store)
    const withdrawn = await store.findById(grant.id)
    expect(withdrawn).toMatchObject({ status: 'withdrawn', withdraw_reason: 'Mail left the Inbox' })
    const { valid, errors } = validate(withdrawn)
    expect(valid, `Schema errors:\n${errors}`).toBe(true)
    expect(validate({ ...withdrawn, withdraw_reason: 'line\nbreak' }).valid).toBe(false)
  })

  it('pending grant (no type field) validates against schema', async () => {
    const store = new InMemoryGrantStore()
    const grant = await createGrant(
      {
        requester: 'agent@example.com',
        target_host: 'macmini.local',
        audience: 'apes',
        grant_type: 'once',
      },
      store,
    )
    const { valid, errors } = validate(grant)
    expect(valid, `Schema errors:\n${errors}`).toBe(true)
  })

  it('grant with type "standing" validates against schema', () => {
    // grant.json enum now includes "standing" — resolved drift.
    const now = Math.floor(Date.now() / 1000)
    const standingGrant: OpenApeGrant = {
      id: crypto.randomUUID(),
      type: 'standing',
      request: {
        requester: 'admin@example.com',
        target_host: 'macmini.local',
        audience: 'apes',
        grant_type: 'always',
        permissions: ['read'],
      },
      status: 'approved',
      decided_by: 'admin@example.com',
      created_at: now - 60,
      decided_at: now,
    }
    const { valid, errors } = validate(standingGrant)
    expect(valid, `Schema errors:\n${errors}`).toBe(true)
  })
})

describe('request summary — grant-request.json', () => {
  const { validate } = getValidator('grant-request.json')
  const request = { requester: 'agent@example.com', target_host: 'macmini.local', audience: 'apes', grant_type: 'once' }
  const accepts = (summary: unknown) => {
    try { return parseGrantSummary(summary) !== undefined }
    catch { return false }
  }

  it.each([
    ['all four fields', { title: 'Rebase PR 395', description: 'Two commits\nNo conflicts', origin: 'Rebase Pod', link: 'https://example.com/pulls/395' }, true],
    ['a title only', { title: 'x'.repeat(120) }, true],
    ['the removed text field', { text: 'Rebase PR 395' }, false],
    ['text next to a title', { title: 'Rebase', text: 'Rebase PR 395' }, false],
    ['a blank title', { title: '  ' }, false],
    ['a long title', { title: 'x'.repeat(121) }, false],
    ['a two-line title', { title: 'a\nb' }, false],
    ['a bidi override', { title: 'Archive \u202Eexe.txt' }, false],
    ['a zero-width space in the origin', { title: 'x', origin: 'Pod\u200B' }, false],
    ['a carriage return in the description', { title: 'x', description: 'a\r\nb' }, false],
    ['a long description', { title: 'x', description: 'x'.repeat(2001) }, false],
  ])('schema and IdP parser agree on %s', (_name, summary, accepted) => {
    expect(validate({ ...request, summary }).valid).toBe(accepted)
    expect(accepts(summary)).toBe(accepted)
  })
})
