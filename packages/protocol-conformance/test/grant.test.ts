import type { OpenApeGrant } from '@openape/core'
import { approveGrant, createGrant, InMemoryGrantStore } from '@openape/grants'
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
