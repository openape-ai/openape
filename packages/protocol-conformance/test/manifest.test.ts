// NOTE: OpenApeManifest.scopes (Record<string, OpenApeScope>) in @openape/core is a SEPARATE,
// richer capability-manifest type — NOT the SP data-access scope catalog validated here.
// It is flagged for Phase 2 (sharpen package boundaries / possible legacy type). The live
// /.well-known/openape.json served by apps/openape-troop uses this array format.

import type { OpenApeManifest } from '@openape/core'
import { validateOpenApeManifest } from '@openape/core'
import { describe, expect, it } from 'vitest'
import { getValidator } from './harness.js'

/** A representative openape.json using the Record format the code produces */
const sampleManifest: OpenApeManifest = {
  version: '1',
  service: {
    name: 'Time Tracker',
    description: 'Track time entries',
    url: 'https://timetrack.example.com',
  },
  auth: {
    supported_methods: ['ddisa'],
    ddisa_domain: 'timetrack.example.com',
  },
  scopes: {
    'timetrack:read': {
      name: 'Read time entries',
      description: 'Read your time entries',
      risk: 'low',
    },
    'timetrack:write': {
      name: 'Write time entries',
      description: 'Create and update time entries',
      risk: 'medium',
    },
  },
  policies: {
    delegation: 'allowed',
  },
}

describe('openape.json manifest — sp-scope-catalog.json', () => {
  const { validate } = getValidator('sp-scope-catalog.json')

  it('validateOpenApeManifest accepts the sample manifest (internal validator)', () => {
    // Confirm the code-side validator accepts the Record-format manifest object.
    const result = validateOpenApeManifest(sampleManifest)
    expect(result.valid, `Validation errors: ${result.errors.join(', ')}`).toBe(true)
  })

  it('array scope catalog validates against sp-scope-catalog.json schema', () => {
    // The live /.well-known/openape.json (apps/openape-troop) and its consumer
    // (modules/nuxt-auth-sp cross-sp-scope-catalog.get.ts) use an ARRAY of
    // {id, description, grants?} objects.  sp-scope-catalog.json (Array) is the
    // correct schema for that wire format.
    const scopeCatalog = [
      { id: 'timetrack:read', description: 'Read your time entries', grants: ['GET /api/me/entries'] },
      { id: 'timetrack:write', description: 'Create and update time entries' },
    ]
    const { valid, errors } = validate(scopeCatalog)
    expect(valid, `Schema errors:\n${errors}`).toBe(true)
  })
})
