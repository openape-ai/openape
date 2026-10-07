import type { Plan } from './report-types'
import { invalid } from '@openape/report-contracts/html'

export function planTextEntries(plan: Plan): { path: string, source: string }[] {
  const entries: { path: string, source: string }[] = []
  function add(value: unknown, path: string) {
    if (typeof value === 'string') entries.push({ path, source: value })
    if (Array.isArray(value)) value.forEach((item, index) => add(item, `${path}.${index}`))
  }
  for (const key of ['title', 'goal', 'summary', 'context', 'scope', 'nonGoals', 'verification', 'handoff'] as const) add(plan[key], key)
  if (plan.problem) {
    for (const [key, value] of Object.entries(plan.problem)) add(value, `problem.${key}`)
  }
  const groups = [
    [plan.milestones, 'milestones', ['title', 'goal', 'steps', 'acceptance', 'blocker', 'proof', 'rollback']],
    [plan.decisions, 'decisions', ['title', 'description']],
    [plan.risks, 'risks', ['title', 'mitigation']],
    [plan.sections, 'sections', ['title', 'body']],
    [plan.changelog, 'changelog', ['text']],
  ] as const
  for (const [records, group, keys] of groups) {
    records?.forEach((record, index) => {
      for (const key of keys) add(Reflect.get(record, key), `${group}.${index}.${key}`)
    })
  }
  if (plan.completion) add(plan.completion.summary, 'completion.summary')
  return entries
}

export function validatePlanTranslations(plan: Plan): void {
  if (!plan.translations) return
  if (plan.language && plan.language !== 'en') invalid('Bilingual Plans require English source language en')
  if (!plan.summary || !plan.problem) invalid('Bilingual Plans require summary and problem overview')
  const sources = new Map(planTextEntries(plan).map(entry => [entry.path, entry.source]))
  const translated = new Set<string>()
  for (const entry of plan.translations.entries) {
    if (translated.has(entry.path)) invalid(`Duplicate translation path: ${entry.path}`)
    if (!sources.has(entry.path)) invalid(`Unknown translation path: ${entry.path}`)
    if (sources.get(entry.path) !== entry.source) invalid(`Stale translation source: ${entry.path}`)
    translated.add(entry.path)
  }
  const missing = [...sources.keys()].filter(path => !translated.has(path))
  if (missing.length) invalid(`Missing German translations: ${missing.join(', ')}`)
}

export function germanPlan(plan: Plan): Plan {
  const localized = structuredClone(plan)
  for (const entry of plan.translations?.entries ?? []) {
    const parts = entry.path.split('.')
    let parent: object = localized
    for (const part of parts.slice(0, -1)) parent = Reflect.get(parent, part)
    Reflect.set(parent, parts.at(-1)!, entry.text)
  }
  return { ...localized, language: 'de' }
}
