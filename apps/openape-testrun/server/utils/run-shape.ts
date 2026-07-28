import { createProblemError } from './problem'

export type RunStatus = 'passed' | 'failed' | 'skipped'

export interface RunStep {
  title: string
  /** Markdown. Raw HTML is escaped at render time. */
  caption?: string
  /** Asset path relative to the upload dir, e.g. "login/01-landing.png". */
  shot?: string
  status?: RunStatus
}

export interface RunTest {
  id: string
  title: string
  /** Markdown. */
  description?: string
  status: RunStatus
  /** Markdown — failure details (error message, stack excerpt). */
  error?: string
  steps: RunStep[]
}

export interface RunManifest {
  title: string
  project?: string
  /** Markdown. */
  summary?: string
  startedAt?: string
  finishedAt?: string
  tests: RunTest[]
}

const STATUSES: RunStatus[] = ['passed', 'failed', 'skipped']
const MAX_TESTS = 200
const MAX_STEPS_PER_TEST = 100
const MAX_TEXT = 20_000
/** shot paths: nested segments of [a-z0-9._-], no traversal, png/jpg/webp/gif. */
const SHOT_PATH = /^(?:[\w.-]+\/)*[\w.-]+\.(?:png|jpe?g|webp|gif)$/i

function asTrimmedString(value: unknown, field: string, opts: { required?: boolean, max?: number } = {}): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (opts.required) throw createProblemError({ status: 400, title: 'Invalid manifest', detail: `"${field}" is required.` })
    return undefined
  }
  if (typeof value !== 'string') {
    throw createProblemError({ status: 400, title: 'Invalid manifest', detail: `"${field}" must be a string.` })
  }
  const trimmed = value.trim()
  if (trimmed.length > (opts.max ?? MAX_TEXT)) {
    throw createProblemError({ status: 400, title: 'Invalid manifest', detail: `"${field}" exceeds ${opts.max ?? MAX_TEXT} characters.` })
  }
  return trimmed
}

function asStatus(value: unknown, field: string): RunStatus {
  if (!STATUSES.includes(value as RunStatus)) {
    throw createProblemError({ status: 400, title: 'Invalid manifest', detail: `"${field}" must be one of ${STATUSES.join(', ')}.` })
  }
  return value as RunStatus
}

/**
 * Validate an uploaded manifest into the canonical RunManifest shape.
 * Throws RFC 7807-style 400s with a field-level detail on any violation.
 */
export function validateManifest(raw: unknown): RunManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw createProblemError({ status: 400, title: 'Invalid manifest', detail: 'Body must be a JSON object.' })
  }
  const m = raw as Record<string, unknown>
  const title = asTrimmedString(m.title, 'title', { required: true, max: 300 })!
  const project = asTrimmedString(m.project, 'project', { max: 200 })
  const summary = asTrimmedString(m.summary, 'summary')
  const startedAt = asTrimmedString(m.startedAt, 'startedAt', { max: 64 })
  const finishedAt = asTrimmedString(m.finishedAt, 'finishedAt', { max: 64 })

  if (!Array.isArray(m.tests) || m.tests.length === 0) {
    throw createProblemError({ status: 400, title: 'Invalid manifest', detail: '"tests" must be a non-empty array.' })
  }
  if (m.tests.length > MAX_TESTS) {
    throw createProblemError({ status: 400, title: 'Invalid manifest', detail: `At most ${MAX_TESTS} tests per run.` })
  }

  const seenIds = new Set<string>()
  const tests = m.tests.map((rawTest, ti) => {
    if (typeof rawTest !== 'object' || rawTest === null) {
      throw createProblemError({ status: 400, title: 'Invalid manifest', detail: `tests[${ti}] must be an object.` })
    }
    const t = rawTest as Record<string, unknown>
    const id = asTrimmedString(t.id, `tests[${ti}].id`, { required: true, max: 200 })!
    if (seenIds.has(id)) {
      throw createProblemError({ status: 400, title: 'Invalid manifest', detail: `Duplicate test id "${id}".` })
    }
    seenIds.add(id)

    const steps = Array.isArray(t.steps) ? t.steps : []
    if (steps.length > MAX_STEPS_PER_TEST) {
      throw createProblemError({ status: 400, title: 'Invalid manifest', detail: `tests[${ti}] exceeds ${MAX_STEPS_PER_TEST} steps.` })
    }

    return {
      id,
      title: asTrimmedString(t.title, `tests[${ti}].title`, { required: true, max: 300 })!,
      description: asTrimmedString(t.description, `tests[${ti}].description`),
      status: asStatus(t.status, `tests[${ti}].status`),
      error: asTrimmedString(t.error, `tests[${ti}].error`),
      steps: steps.map((rawStep, si) => {
        if (typeof rawStep !== 'object' || rawStep === null) {
          throw createProblemError({ status: 400, title: 'Invalid manifest', detail: `tests[${ti}].steps[${si}] must be an object.` })
        }
        const s = rawStep as Record<string, unknown>
        const shot = asTrimmedString(s.shot, `tests[${ti}].steps[${si}].shot`, { max: 500 })
        if (shot && !SHOT_PATH.test(shot)) {
          throw createProblemError({
            status: 400,
            title: 'Invalid manifest',
            detail: `tests[${ti}].steps[${si}].shot "${shot}" must be a relative image path (png/jpg/webp/gif, segments of letters, digits, ".", "_", "-").`,
          })
        }
        return {
          title: asTrimmedString(s.title, `tests[${ti}].steps[${si}].title`, { required: true, max: 300 })!,
          caption: asTrimmedString(s.caption, `tests[${ti}].steps[${si}].caption`),
          shot,
          status: s.status === undefined ? undefined : asStatus(s.status, `tests[${ti}].steps[${si}].status`),
        }
      }),
    }
  })

  return { title, project, summary, startedAt, finishedAt, tests }
}

export function aggregateStatus(tests: RunTest[]): { status: RunStatus, passed: number, failed: number, skipped: number } {
  const passed = tests.filter(t => t.status === 'passed').length
  const failed = tests.filter(t => t.status === 'failed').length
  const skipped = tests.filter(t => t.status === 'skipped').length
  const status: RunStatus = failed > 0 ? 'failed' : passed > 0 ? 'passed' : 'skipped'
  return { status, passed, failed, skipped }
}

/** All shot paths referenced by a manifest (deduped). */
export function referencedShots(manifest: RunManifest): string[] {
  const shots = new Set<string>()
  for (const test of manifest.tests) {
    for (const step of test.steps) {
      if (step.shot) shots.add(step.shot)
    }
  }
  return [...shots]
}
