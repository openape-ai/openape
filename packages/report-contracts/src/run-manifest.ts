import { ReportError } from './html'

function manifestError(detail: string): ReportError {
  return new ReportError('VALIDATION', detail)
}

export type RunStatus = 'passed' | 'failed' | 'skipped'

export interface RunStep {
  title: string
  caption?: string
  shot?: string
  status?: RunStatus
}

export interface RunTest {
  id: string
  title: string
  description?: string
  status: RunStatus
  error?: string
  steps: RunStep[]
}

export interface RunManifest {
  title: string
  project?: string
  summary?: string
  series?: string
  startedAt?: string
  finishedAt?: string
  tests: RunTest[]
}

const STATUSES: RunStatus[] = ['passed', 'failed', 'skipped']
const MAX_TESTS = 200
const MAX_STEPS_PER_TEST = 100
const MAX_TEXT = 20_000
const SHOT_PATH = /^(?:[\w.-]+\/)*[\w.-]+\.(?:png|jpe?g|webp|gif)$/i

function asTrimmedString(value: unknown, field: string, opts: { required?: boolean, max?: number } = {}): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (opts.required) throw manifestError(`"${field}" is required.`)
    return undefined
  }
  if (typeof value !== 'string') {
    throw manifestError(`"${field}" must be a string.`)
  }
  const trimmed = value.trim()
  if (opts.required && !trimmed) throw manifestError(`"${field}" is required.`)
  if (trimmed.length > (opts.max ?? MAX_TEXT)) {
    throw manifestError(`"${field}" exceeds ${opts.max ?? MAX_TEXT} characters.`)
  }
  return trimmed
}

function asStatus(value: unknown, field: string): RunStatus {
  if (!STATUSES.includes(value as RunStatus)) {
    throw manifestError(`"${field}" must be one of ${STATUSES.join(', ')}.`)
  }
  return value as RunStatus
}

export function validateManifest(raw: unknown): RunManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw manifestError('Body must be a JSON object.')
  }
  const m = raw as Record<string, unknown>
  const title = asTrimmedString(m.title, 'title', { required: true, max: 300 })!
  const project = asTrimmedString(m.project, 'project', { max: 200 })
  const summary = asTrimmedString(m.summary, 'summary')
  const series = asTrimmedString(m.series, 'series', { max: 200 })
  const startedAt = asTrimmedString(m.startedAt, 'startedAt', { max: 64 })
  const finishedAt = asTrimmedString(m.finishedAt, 'finishedAt', { max: 64 })

  if (!Array.isArray(m.tests) || m.tests.length === 0) {
    throw manifestError('"tests" must be a non-empty array.')
  }
  if (m.tests.length > MAX_TESTS) {
    throw manifestError(`At most ${MAX_TESTS} tests per run.`)
  }

  const seenIds = new Set<string>()
  const tests = m.tests.map((rawTest, ti) => {
    if (typeof rawTest !== 'object' || rawTest === null) {
      throw manifestError(`tests[${ti}] must be an object.`)
    }
    const t = rawTest as Record<string, unknown>
    const id = asTrimmedString(t.id, `tests[${ti}].id`, { required: true, max: 200 })!
    if (seenIds.has(id)) {
      throw manifestError(`Duplicate test id "${id}".`)
    }
    seenIds.add(id)

    const steps = Array.isArray(t.steps) ? t.steps : []
    if (steps.length > MAX_STEPS_PER_TEST) {
      throw manifestError(`tests[${ti}] exceeds ${MAX_STEPS_PER_TEST} steps.`)
    }

    return {
      id,
      title: asTrimmedString(t.title, `tests[${ti}].title`, { required: true, max: 300 })!,
      description: asTrimmedString(t.description, `tests[${ti}].description`),
      status: asStatus(t.status, `tests[${ti}].status`),
      error: asTrimmedString(t.error, `tests[${ti}].error`),
      steps: steps.map((rawStep, si) => {
        if (typeof rawStep !== 'object' || rawStep === null) {
          throw manifestError(`tests[${ti}].steps[${si}] must be an object.`)
        }
        const s = rawStep as Record<string, unknown>
        const shot = asTrimmedString(s.shot, `tests[${ti}].steps[${si}].shot`, { max: 500 })
        if (shot && (!SHOT_PATH.test(shot) || shot.split('/').some(segment => segment === '.' || segment === '..'))) {
          throw manifestError(`tests[${ti}].steps[${si}].shot "${shot}" must be a relative image path (png/jpg/webp/gif, segments of letters, digits, ".", "_", "-").`)
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

  return { title, project, summary, series, startedAt, finishedAt, tests }
}

export function aggregateStatus(tests: RunTest[]): { status: RunStatus, passed: number, failed: number, skipped: number } {
  const passed = tests.filter(t => t.status === 'passed').length
  const failed = tests.filter(t => t.status === 'failed').length
  const skipped = tests.filter(t => t.status === 'skipped').length
  const status: RunStatus = failed > 0 ? 'failed' : passed > 0 ? 'passed' : 'skipped'
  return { status, passed, failed, skipped }
}

export function referencedShots(manifest: RunManifest): string[] {
  const shots = new Set<string>()
  for (const test of manifest.tests) {
    for (const step of test.steps) {
      if (step.shot) shots.add(step.shot)
    }
  }
  return [...shots]
}
