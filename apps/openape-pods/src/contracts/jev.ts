import type { PodResource } from './resources'
import type { ProgramAuthority } from '../main/programs/grants'

export const typesafeOrigin = 'https://api.typesafe.ai'
export const defaultJevModel = 'jev-1.13.0'
export const jevMaxAttempts = 20
export type JevDescription = string | Record<string, unknown> | unknown[]
export type JevQuestion =
  | { type: 'choice', instructions: JevDescription, criteria: Record<string, JevDescription | null> }
  | { type: 'score', instructions: JevDescription, criteria: JevDescription[] }
  | { type: 'noul', instructions: JevDescription, criteria?: { true?: JevDescription, false?: JevDescription } }
export interface JevRequest { state: JevDescription, questions: Record<string, JevQuestion> }
export type JevAnswer =
  | { type: 'choice', choice: string, probabilities: Record<string, number>, confidence: number }
  | { type: 'score', score: number, legend: Record<string, string>, probabilities: Record<string, number>, confidence: number }
  | { type: 'noul', noul: number }
export interface JevResult { model: string, answers: Record<string, JevAnswer>, usage: { input_tokens: number, output_tokens: number } }
export interface JevEvaluation { result: JevResult, attempts: number }
export interface JevAvailability { id: string, state: string, verifiedAt: number | null }
export interface JevAssignment { type: 'jev', capability: 'jev.evaluate', connectionId: string, model: string, maxAttempts: number, authority: ProgramAuthority }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Jev object')
  return value as Record<string, unknown>
}
function fields(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unsupported Jev field')
}
function json(value: unknown, depth = 0): void {
  if (depth > 20) throw new Error('Jev input is nested too deeply')
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return
  if (!value || typeof value !== 'object') throw new Error('Jev input must be JSON')
  for (const child of Object.values(value)) json(child, depth + 1)
}
function description(value: unknown): void {
  if (typeof value !== 'string' && (!value || typeof value !== 'object')) throw new Error('Invalid Jev description')
  json(value)
}
export function parseJevModel(value: unknown): string {
  if (typeof value !== 'string' || !/^jev-\d+\.\d+\.\d+$/.test(value) || value.length > 64) throw new Error('Choose a pinned Jev model version, for example jev-1.13.0')
  return value
}
export function parseTypesafeKey(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 4096 || /[^\x21-\x7E]/.test(value)) throw new Error('Enter a TypeSafe API key without whitespace')
  return value
}
export function parseJevAvailability(value: unknown): JevAvailability | null {
  if (value === null) return null
  const item = object(value)
  fields(item, ['id', 'state', 'verifiedAt'])
  if (typeof item.id !== 'string' || !/^[a-f0-9-]{36}$/.test(item.id) || !['ready', 'expired', 'revoked', 'failed', 'connecting'].includes(String(item.state)) || (item.verifiedAt !== null && (!Number.isSafeInteger(item.verifiedAt) || Number(item.verifiedAt) < 0))) throw new Error('Invalid TypeSafe availability')
  return { id: item.id, state: String(item.state), verifiedAt: item.verifiedAt as number | null }
}
export function parseJevRequest(value: unknown): JevRequest {
  const request = object(value)
  fields(request, ['state', 'questions'])
  description(request.state)
  const questions = object(request.questions)
  if (!Object.keys(questions).length || Object.keys(questions).length > 128) throw new Error('Use between 1 and 128 Jev questions')
  for (const [id, raw] of Object.entries(questions)) {
    if (!/^[a-z][\w-]{0,63}$/i.test(id)) throw new Error('Invalid Jev question ID')
    const question = object(raw)
    fields(question, ['type', 'instructions', 'criteria'])
    description(question.instructions)
    if (question.type === 'choice') {
      const criteria = object(question.criteria)
      if (!Object.keys(criteria).length || Object.keys(criteria).length > 255) throw new Error('Use between 1 and 255 Jev choices')
      for (const [option, text] of Object.entries(criteria)) {
        if (!option || option.length > 128) throw new Error('Invalid Jev option')
        if (text !== null) description(text)
      }
    }
    else if (question.type === 'score') {
      if (!Array.isArray(question.criteria) || question.criteria.length < 2 || question.criteria.length > 10) throw new Error('Use between 2 and 10 Jev score levels')
      question.criteria.forEach(description)
    }
    else if (question.type === 'noul') {
      if (question.criteria !== undefined) {
        const criteria = object(question.criteria)
        fields(criteria, ['true', 'false']); Object.values(criteria).forEach(description)
      }
    }
    else {
      throw new Error('Unsupported Jev question type')
    }
  }
  if (new TextEncoder().encode(JSON.stringify(request)).length > 128 * 1024) throw new Error('Jev request exceeds 128 KiB')
  return structuredClone(request) as unknown as JevRequest
}
function probability(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid Jev probability')
  return value
}
function sameKeys(value: Record<string, unknown>, expected: string[]): void {
  if (Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) throw new Error('Jev response keys do not match the question')
}
function probabilities(value: unknown, keys: string[]): Record<string, number> {
  const result = object(value); sameKeys(result, keys)
  const entries = Object.entries(result).map(([key, number]) => [key, probability(number)] as const)
  if (Math.abs(entries.reduce((sum, [, number]) => sum + number, 0) - 1) > 0.01) throw new Error('Invalid Jev probability distribution')
  return Object.fromEntries(entries)
}
export function parseJevResult(value: unknown, request: JevRequest, model: string): JevResult {
  const result = object(value)
  if (result.model !== parseJevModel(model)) throw new Error('Jev returned a different model version')
  const answers = object(result.answers); sameKeys(answers, Object.keys(request.questions))
  const parsed = Object.fromEntries(Object.entries(request.questions).map(([id, question]): [string, JevAnswer] => {
    const answer = object(answers[id])
    if (answer.type !== question.type) throw new Error('Jev answer type does not match the question')
    if (question.type === 'noul') return [id, { type: 'noul', noul: probability(answer.noul) }]
    const confidence = probability(answer.confidence)
    if (question.type === 'choice') {
      if (typeof answer.choice !== 'string' || !Object.hasOwn(question.criteria, answer.choice)) throw new Error('Jev returned an unknown choice')
      return [id, { type: 'choice', choice: answer.choice, confidence, probabilities: probabilities(answer.probabilities, Object.keys(question.criteria)) }]
    }
    const keys = question.criteria.map((_, index) => String(index))
    const legend = object(answer.legend); sameKeys(legend, keys)
    if (Object.values(legend).some(value => typeof value !== 'string')) throw new Error('Invalid Jev score legend')
    if (typeof answer.score !== 'number' || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > keys.length - 1) throw new Error('Invalid Jev score')
    return [id, { type: 'score', score: answer.score, confidence, probabilities: probabilities(answer.probabilities, keys), legend: legend as Record<string, string> }]
  }))
  const usage = object(result.usage)
  if (![usage.input_tokens, usage.output_tokens].every(value => Number.isSafeInteger(value) && Number(value) >= 0)) throw new Error('Invalid Jev token usage')
  return { model, answers: parsed, usage: { input_tokens: Number(usage.input_tokens), output_tokens: Number(usage.output_tokens) } }
}
export function assignedJev(resources: PodResource[], podId: string, capabilities: string[]): JevAssignment {
  const resource = resources.find(item => item.podId === podId && item.kind === 'tool' && item.state === 'ready' && item.configuration.type === 'jev')
  if (!resource || !capabilities.includes('jev.evaluate')) throw new Error('Jev is not assigned to this script')
  const assignment = resource.configuration as unknown as JevAssignment
  parseJevModel(assignment.model)
  if (!/^[a-f0-9-]{36}$/.test(assignment.connectionId) || assignment.capability !== 'jev.evaluate' || !Number.isSafeInteger(assignment.maxAttempts) || assignment.maxAttempts < 1 || assignment.maxAttempts > 100) throw new Error('Invalid Jev assignment')
  if (assignment.authority?.identity?.podId !== podId || !assignment.authority.grantId) throw new Error('Jev permission has no matching Pod identity')
  return assignment
}
export function syntheticJevResult(request: JevRequest, model: string): JevResult {
  const answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (question.type === 'noul') return [id, { type: 'noul', noul: 0.5 }]
    const keys = question.type === 'choice' ? Object.keys(question.criteria) : question.criteria.map((_, index) => String(index))
    const probabilities = Object.fromEntries(keys.map(key => [key, 1 / keys.length]))
    return [id, question.type === 'choice' ? { type: 'choice', choice: keys[0], probabilities, confidence: 0 } : { type: 'score', score: (keys.length - 1) / 2, probabilities, confidence: 0, legend: Object.fromEntries(keys.map(key => [key, JSON.stringify(question.criteria[Number(key)])])) }]
  }))
  return parseJevResult({ model, answers, usage: { input_tokens: 0, output_tokens: 0 } }, request, model)
}
