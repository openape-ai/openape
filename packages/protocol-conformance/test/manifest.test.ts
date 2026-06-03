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
    // Confirm the code-side validator accepts this object before testing schema.
    const result = validateOpenApeManifest(sampleManifest)
    expect(result.valid, `Validation errors: ${result.errors.join(', ')}`).toBe(true)
  })

  it.fails('manifest scopes (Record format) validates against sp-scope-catalog.json schema (Array format)', () => {
    // DRIFT: code uses Record<string, OpenApeScope> (object keyed by scope id)
    // but sp-scope-catalog.json expects an Array of {id, description, grants?}; see docs/superpowers/DRIFT-REPORT-m3.md
    // The manifest's `scopes` property is an object, but the schema root type is `array`.
    const { valid, errors } = validate(sampleManifest.scopes)
    expect(valid, `Schema errors:\n${errors}`).toBe(true)
  })
})
