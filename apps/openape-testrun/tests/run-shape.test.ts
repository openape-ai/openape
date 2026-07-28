import { describe, expect, it } from 'vitest'
import { aggregateStatus, referencedShots, validateManifest } from '../server/utils/run-shape'

// run-shape is the trust-boundary validator for an uploaded test-run manifest:
// it parses untrusted JSON into the canonical RunManifest, rejecting anything
// malformed before it reaches the DB or the public proof-link renderer. These
// tests exercise the real validator (it throws RFC 7807-style H3Errors) — no
// boot, no DB, no mocks.

function validManifest() {
  return {
    title: '  Login flow  ',
    project: 'openape',
    summary: 'It works',
    tests: [
      { id: 't1', title: 'logs in', status: 'passed', steps: [
        { title: 'land', caption: 'Landing page', shot: 'login/01-landing.png', status: 'passed' },
        { title: 'submit', shot: 'login/02-submit.png' },
      ] },
      { id: 't2', title: 'rejects bad creds', status: 'failed', error: 'boom', steps: [] },
      { id: 't3', title: 'skips 2fa', status: 'skipped', steps: [] },
    ],
  }
}

// Assert that fn throws an H3 problem error with the given status (and detail).
function expectProblem(fn: () => unknown, status: number, detailMatch?: RegExp) {
  let err: { statusCode?: number, data?: { detail?: string } } | undefined
  try { fn() }
  catch (e) { err = e as typeof err }
  expect(err, 'expected a thrown problem error').toBeDefined()
  expect(err!.statusCode).toBe(status)
  if (detailMatch) expect(err!.data?.detail).toMatch(detailMatch)
}

describe('validateManifest — happy path', () => {
  it('returns the canonical shape with strings trimmed', () => {
    const m = validateManifest(validManifest())
    expect(m.title).toBe('Login flow')
    expect(m.tests).toHaveLength(3)
    expect(m.tests[0]!.steps[0]!.shot).toBe('login/01-landing.png')
    expect(m.tests[0]!.steps[1]!.status).toBeUndefined()
  })

  it('accepts a nested relative image path', () => {
    const raw = validManifest()
    raw.tests[0]!.steps[0]!.shot = 'a/b/c-1.webp'
    expect(() => validateManifest(raw)).not.toThrow()
  })
})

describe('validateManifest — rejections (400)', () => {
  it('rejects a non-object body', () => {
    expectProblem(() => validateManifest(null), 400, /JSON object/)
    expectProblem(() => validateManifest('nope'), 400, /JSON object/)
  })

  it('rejects a missing title', () => {
    const raw = validManifest() as Record<string, unknown>
    delete raw.title
    expectProblem(() => validateManifest(raw), 400, /"title" is required/)
  })

  it('rejects an empty or non-array tests list', () => {
    const raw = validManifest() as Record<string, unknown>
    raw.tests = []
    expectProblem(() => validateManifest(raw), 400, /non-empty array/)
    raw.tests = 'x'
    expectProblem(() => validateManifest(raw), 400, /non-empty array/)
  })

  it('rejects duplicate test ids', () => {
    const raw = validManifest()
    raw.tests[1]!.id = 't1'
    expectProblem(() => validateManifest(raw), 400, /Duplicate test id "t1"/)
  })

  it('rejects an invalid status', () => {
    const raw = validManifest()
    ;(raw.tests[0] as Record<string, unknown>).status = 'flaky'
    expectProblem(() => validateManifest(raw), 400, /must be one of/)
  })

  it('rejects an over-length title', () => {
    const raw = validManifest()
    raw.title = 'x'.repeat(301)
    expectProblem(() => validateManifest(raw), 400, /exceeds 300/)
  })

  it('rejects a shot with a non-image extension', () => {
    const raw = validManifest()
    raw.tests[0]!.steps[0]!.shot = 'login/report.svg'
    expectProblem(() => validateManifest(raw), 400, /relative image path/)
  })

  it('rejects a shot path with disallowed characters', () => {
    const raw = validManifest()
    raw.tests[0]!.steps[0]!.shot = 'login/a b.png'
    expectProblem(() => validateManifest(raw), 400, /relative image path/)
  })
})

describe('aggregateStatus', () => {
  it('reports failed when any test failed', () => {
    const m = validateManifest(validManifest())
    expect(aggregateStatus(m.tests)).toEqual({ status: 'failed', passed: 1, failed: 1, skipped: 1 })
  })

  it('reports passed when some passed and none failed', () => {
    const m = validateManifest(validManifest())
    const noFail = m.tests.filter(t => t.status !== 'failed')
    expect(aggregateStatus(noFail)).toMatchObject({ status: 'passed', passed: 1, skipped: 1 })
  })

  it('reports skipped when all tests skipped', () => {
    const m = validateManifest(validManifest())
    const onlySkipped = m.tests.filter(t => t.status === 'skipped')
    expect(aggregateStatus(onlySkipped)).toEqual({ status: 'skipped', passed: 0, failed: 0, skipped: 1 })
  })
})

describe('referencedShots', () => {
  it('collects every shot path, deduped, ignoring steps without one', () => {
    const m = validateManifest(validManifest())
    expect(referencedShots(m)).toEqual(['login/01-landing.png', 'login/02-submit.png'])
  })

  it('dedupes a shot referenced by two steps', () => {
    const raw = validManifest()
    raw.tests[0]!.steps[1]!.shot = 'login/01-landing.png'
    const m = validateManifest(raw)
    expect(referencedShots(m)).toEqual(['login/01-landing.png'])
  })
})
