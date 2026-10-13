import { randomUUID } from 'node:crypto'
import { namespacePath, ownerWriter, plainJson, recordKey } from '../../contracts/domain-data'
import { canonicalJson } from '../../contracts/canonical-json'
import type { PodDatabase } from '../storage/database'
import type { DomainData } from './domain'

export interface QuestionOption { key: string, title: string }
export interface OwnerQuestion { id: string, podId: string, namespace: string, key: string, fingerprint: string, title: string, body: string, options: QuestionOption[], data: Record<string, unknown>, state: 'pending' | 'decided' | 'superseded' | 'withdrawn', option: string | null, decidedAt: number | null, createdAt: number }
const optionKey = /^[\w.-]{1,64}$/
const pendingPerPod = 500

function text(value: unknown, maximum: number, name: string, empty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim())) throw new Error(`Invalid question ${name}`)
  return value
}

function question(row: Record<string, unknown>): OwnerQuestion {
  return { id: String(row.id), podId: String(row.pod_id), namespace: String(row.namespace), key: String(row.key), fingerprint: String(row.fingerprint), title: String(row.title), body: String(row.body), options: JSON.parse(String(row.options)) as QuestionOption[], data: JSON.parse(String(row.data)) as Record<string, unknown>, state: row.state as OwnerQuestion['state'], option: row.option as string | null, decidedAt: row.decided_at as number | null, createdAt: Number(row.created_at) }
}

/**
 * Durable owner questions (issue 1465). One question per object and input fingerprint, never one per run; the answer
 * is written by the owner into the question's namespace, separate from machine assessments. No Pod or model answers.
 */
export class OwnerQuestions {
  constructor(private readonly store: PodDatabase, private readonly data: DomainData) {}

  ask(principal: { podId: string, runId: string }, value: unknown): OwnerQuestion {
    const input = plainJson(value) as Record<string, unknown>
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['namespace', 'key', 'fingerprint', 'title', 'body', 'options', 'data'].includes(key))) throw new Error('Invalid owner question')
    const namespace = namespacePath(input.namespace); const key = recordKey(input.key)
    const fingerprint = text(input.fingerprint, 128, 'fingerprint'); const title = text(input.title, 300, 'title'); const body = text(input.body ?? '', 4000, 'body', true)
    if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 16) throw new Error('A question offers 2 to 16 options')
    const options = input.options.map((entry) => {
      const option = entry as Record<string, unknown>
      if (!option || typeof option !== 'object' || typeof option.key !== 'string' || !optionKey.test(option.key)) throw new Error('Invalid question option')
      return { key: option.key, title: text(option.title, 200, 'option') }
    })
    if (new Set(options.map(option => option.key)).size !== options.length) throw new Error('Duplicate question option')
    const data = input.data === undefined ? {} : input.data as Record<string, unknown>
    if (!data || typeof data !== 'object' || Array.isArray(data) || canonicalJson(data).length > 16384) throw new Error('Question data is limited to 16 KiB')
    return this.store.transaction(() => {
      const view = this.data.namespace(namespace)
      if (view.writer !== ownerWriter) throw new Error('Owner answers go to a namespace the owner writes')
      if (!view.readers.includes(principal.podId)) throw new Error(`This Pod may not read ${namespace}`)
      if (!this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=? AND run_id=? AND boot_id NOT LIKE \'fenced:%\'').get(principal.podId, principal.runId)) throw new Error('Questions require the Pod\'s active run')
      const existing = this.store.db.prepare('SELECT * FROM owner_questions WHERE pod_id=? AND namespace=? AND key=? AND fingerprint=?').get(principal.podId, namespace, key, fingerprint)
      if (existing && existing.state !== 'pending') return question(existing)
      // Asking again about the same input refreshes how a waiting question is presented; it stays one question.
      if (existing) {
        this.store.db.prepare('UPDATE owner_questions SET title=?,body=?,options=?,data=? WHERE id=? AND state=\'pending\'').run(title, body, JSON.stringify(options), canonicalJson(data), existing.id)
        return this.get(String(existing.id))
      }
      // One answer slot belongs to the Pod that asked about it; another Pod neither replaces nor overwrites it.
      if (this.store.db.prepare('SELECT 1 FROM owner_questions WHERE namespace=? AND key=? AND pod_id<>? AND state=\'pending\'').get(namespace, key, principal.podId)) throw new Error('Another Pod already asks the owner about this key')
      this.assertAnswerSlot(`${namespace}/${key}`, principal.podId)
      if (Number(this.store.db.prepare('SELECT count(*) AS count FROM owner_questions WHERE pod_id=? AND state=\'pending\'').get(principal.podId)!.count) >= pendingPerPod) throw new Error('Too many open owner questions; wait until the owner answered some')
      this.store.db.prepare('UPDATE owner_questions SET state=\'superseded\' WHERE pod_id=? AND namespace=? AND key=? AND state=\'pending\'').run(principal.podId, namespace, key)
      const id = randomUUID()
      this.store.db.prepare('INSERT INTO owner_questions VALUES(?,?,?,?,?,?,?,?,?,\'pending\',NULL,NULL,?)').run(id, principal.podId, namespace, key, fingerprint, title, body, JSON.stringify(options), canonicalJson(data), Date.now())
      return this.get(id)
    })
  }

  /** A Pod withdraws its waiting question about an object that no longer needs the owner. */
  withdraw(principal: { podId: string, runId: string }, value: unknown): { withdrawn: number } {
    const input = plainJson(value) as Record<string, unknown>
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['namespace', 'key'].includes(key))) throw new Error('Invalid question withdrawal')
    const namespace = namespacePath(input.namespace); const key = recordKey(input.key)
    return this.store.transaction(() => {
      if (!this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=? AND run_id=? AND boot_id NOT LIKE \'fenced:%\'').get(principal.podId, principal.runId)) throw new Error('Questions require the Pod\'s active run')
      const changes = this.store.db.prepare('UPDATE owner_questions SET state=\'withdrawn\' WHERE pod_id=? AND namespace=? AND key=? AND state=\'pending\'').run(principal.podId, namespace, key).changes
      return { withdrawn: Number(changes) }
    })
  }

  /** An answer may replace an earlier answer of the same Pod, never another owner record such as a policy. */
  private assertAnswerSlot(key: string, podId: string): void {
    const existing = this.data.get(ownerWriter, key)
    if (!existing) return
    const questionId = existing.value && typeof existing.value === 'object' ? (existing.value as { questionId?: unknown }).questionId : undefined
    if (typeof questionId !== 'string') throw new Error('This key holds an owner record that is not an answer')
    if (this.store.db.prepare('SELECT pod_id FROM owner_questions WHERE id=?').get(questionId)?.pod_id !== podId) throw new Error('This key holds the answer to another Pod\'s question')
  }

  get(id: string): OwnerQuestion {
    const row = this.store.db.prepare('SELECT * FROM owner_questions WHERE id=?').get(id)
    if (!row) throw new Error('Owner question not found')
    return question(row)
  }

  pending(limit = 500): OwnerQuestion[] {
    return this.store.db.prepare('SELECT * FROM owner_questions WHERE state=\'pending\' ORDER BY created_at,id LIMIT ?').all(limit).map(question)
  }

  /** Owner command: records the chosen option as an owner-written entry bound to the question's input. */
  answer(id: string, option: string): OwnerQuestion {
    return this.store.transaction(() => {
      const current = this.get(id)
      if (current.state !== 'pending') throw new Error('This question is no longer waiting')
      if (!current.options.some(item => item.key === option)) throw new Error('This option is not available for the question')
      const decidedAt = Date.now()
      this.store.db.prepare('UPDATE owner_questions SET state=\'decided\',option=?,decided_at=? WHERE id=? AND state=\'pending\'').run(option, decidedAt, id)
      const key = `${current.namespace}/${current.key}`
      this.assertAnswerSlot(key, current.podId)
      // The owner's answer is the option; what the asking Pod supplied stays marked as its question.
      this.data.set(ownerWriter, key, { option, questionId: id, fingerprint: current.fingerprint, decidedAt, question: { podId: current.podId, title: current.title, data: current.data } }, this.data.revision(key))
      return this.get(id)
    })
  }
}
