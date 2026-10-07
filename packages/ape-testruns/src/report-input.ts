import type { Plan, ReportDocument, TestRun } from './report-types'
import { invalid } from '@openape/report-contracts/html'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import schema from '../schemas/report.schema.json'
import { germanPlan, validatePlanTranslations } from './plan-translations'

const ajv = new Ajv2020({ allErrors: true })
addFormats(ajv)
const validate = ajv.compile(schema)

function unique(values: { id: string }[], namespace: string) {
  const ids = new Set<string>()
  for (const value of values) {
    if (ids.has(value.id)) invalid(`Duplicate ${namespace} id: ${value.id}`)
    ids.add(value.id)
  }
  return ids
}

function ordered(value: { startedAt?: string, finishedAt?: string }) {
  if (value.startedAt && value.finishedAt && Date.parse(value.finishedAt) < Date.parse(value.startedAt)) invalid('startedAt and finishedAt must be ordered timestamps')
}

function references(doc: ReportDocument) {
  const targets = unique(doc.targets ?? [], 'target')
  const evidence = unique(doc.evidence ?? [], 'evidence')
  const commands = unique(doc.schema === 'openape.test-run/1' ? doc.commands ?? [] : [], 'command')
  unique(doc.sections ?? [], 'section')
  unique(doc.schema === 'openape.test-run/1' ? doc.tests : doc.milestones, 'detail')
  function walk(value: unknown) {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(walk); return }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'targetId' && !targets.has(child as string)) invalid(`Unknown targetId: ${child}`)
      if (key === 'evidenceIds' || key === 'commandIds') {
        const ids = key === 'evidenceIds' ? evidence : commands
        for (const id of child as string[]) {
          if (!ids.has(id)) invalid(`Unknown ${key}: ${id}`)
        }
      }
      if (key === 'url') {
        const url = new URL(child as string)
        if (url.protocol !== 'https:' || url.username || url.password || [...(child as string)].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) invalid('URLs must be credential-free HTTPS without whitespace')
      }
      walk(child)
    }
  }
  walk(doc)
}

function timestampPrecision(value: string): number {
  const fractionalDigits = value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/iu)?.[1]?.length ?? 0
  return 10 ** (3 - Math.min(fractionalDigits, 3))
}

function checkRun(run: TestRun) {
  ordered(run)
  for (const command of run.commands ?? []) {
    ordered(command)
    if (command.durationMs === undefined || !command.startedAt || !command.finishedAt) continue
    const elapsed = Date.parse(command.finishedAt) - Date.parse(command.startedAt)
    const precision = Math.max(timestampPrecision(command.startedAt), timestampPrecision(command.finishedAt))
    if (Math.abs(command.durationMs - elapsed) > precision) invalid(`Command ${command.id} duration contradicts its timestamps beyond ${precision} ms precision`)
  }
  for (const check of run.tests) {
    if (check.status === 'failed' && !check.error && !check.observed) invalid(`Failed check ${check.id} needs error or observed`)
    for (const step of check.steps ?? []) {
      if (check.status === 'passed' && step.status && step.status !== 'passed') invalid(`Passed check ${check.id} contains an incomplete or failed step`)
      if ((step.status === 'blocked' || step.status === 'skipped') && !step.caption) invalid(`Incomplete step in ${check.id} needs a caption explaining why`)
    }
  }
}

function checkPlan(plan: Plan) {
  if (plan.status === 'done' && plan.milestones.some(item => item.status !== 'done') && !plan.completion) invalid('A done plan with unfinished milestones needs an explicit completion summary')
  const target = plan.approval?.target
  if (target && Boolean(target.url) !== Boolean(target.version)) invalid('Approval URL and version must be provided together')
  if (target?.url && target.sourceDigest) {
    const recorded = plan.provenance?.find(item => item.url === target.url && item.version === target.version)
    if (recorded?.digest && recorded.digest !== target.sourceDigest) invalid('Approval digest contradicts the recorded target version')
  }
}

function validateUnicode(value: unknown, path = 'report'): void {
  if (typeof value === 'string' && /[\uD800-\uDFFF]/u.test(value)) invalid(`Unpaired Unicode surrogate at ${path}`)
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) validateUnicode(child, `${path}.${key}`)
}

export function validateReport(input: unknown): ReportDocument {
  if (!validate(input)) invalid(`Invalid report schema: ${ajv.errorsText(validate.errors, { separator: '; ' })}`)
  validateUnicode(input)
  const doc = input as ReportDocument
  references(doc)
  for (const target of doc.targets ?? []) {
    if (target.dirty && !target.changesDigest) invalid(`Dirty target ${target.id} needs changesDigest`)
  }
  if (doc.schema === 'openape.test-run/1') {
    checkRun(doc)
  }
  else {
    checkPlan(doc)
    validatePlanTranslations(doc)
    if (doc.translations) {
      const localized = germanPlan(doc)
      delete localized.translations
      if (!validate(localized)) invalid(`Invalid German plan fields: ${ajv.errorsText(validate.errors, { separator: '; ' })}`)
    }
  }
  return doc
}

export function isVersioned(input: unknown): boolean {
  return Boolean(input && typeof input === 'object' && 'schema' in input)
}

export function runResult(run: TestRun): 'failed' | 'incomplete' | 'passed' {
  if (run.tests.some(test => test.status === 'failed')) return 'failed'
  if (run.tests.some(test => test.status !== 'passed')) return 'incomplete'
  return 'passed'
}

export function runCommit(run: TestRun): string | undefined {
  const targets = run.tests.map(test => run.targets?.find(target => target.id === test.targetId))
  if (targets.some(target => target?.kind !== 'source' || !target.commit || target.dirty)) return undefined
  const commits = new Set(targets.map(target => target!.commit!))
  return commits.size === 1 ? [...commits][0] : undefined
}
