// @vitest-environment node
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBackup, restoreBackup } from '../../src/worker/data/backup'
import { schemaVersion } from '../../src/worker/storage/database'
import { releaseHeldWork } from '../../src/worker/recovery/release'
import { DataRetention } from '../../src/worker/data/retention'
import { classification, cleanup, invoiceReview, workFixture } from './work-fixture'

afterEach(cleanup)

/** Mail Sync writes messages; Classification answers each message once; Invoice Review consumes invoice results. */
function mail() {
  const f = workFixture()
  const sync = f.pod('Mail Sync')
  const classifier = f.pod('Mail Classification', [classification()])
  const invoices = f.pod('Invoice Review', [invoiceReview()])
  f.data.define({ path: 'acme/mail/messages', writer: sync, mode: 'records', readers: [classifier, invoices] })
  f.data.define({ path: 'acme/mail/classifications', writer: classifier, mode: 'results', readers: [invoices] })
  f.data.define({ path: 'acme/mail/invoice-reviews', writer: invoices, mode: 'results' })
  const write = (id: string, value: Record<string, unknown>) => {
    const run = f.run(sync)
    try { return f.data.set(run, `acme/mail/messages/${id}`, value, f.data.revision(`acme/mail/messages/${id}`)) }
    finally { f.finish(run) }
  }
  /** One scheduled classification run: finds, claims and completes everything ready; returns how many it analyzed. */
  const classify = (verdict: (value: Record<string, unknown>) => Record<string, unknown>, pod = classifier) => {
    const run = f.run(pod); let analyzed = 0
    try {
      for (const item of f.work.find(run, { operation: 'acme/mail-classification', limit: 50 })) {
        const claim = f.work.claim(run, { key: item.key })
        analyzed++
        f.work.complete(run, { claimToken: claim.claimToken, result: { ...verdict(claim.input.value as Record<string, unknown>), contentRevision: (claim.input.value as Record<string, unknown>).contentRevision } })
      }
    }
    finally { f.finish(run) }
    return analyzed
  }
  return { ...f, sync, classifier, invoices, write, classify }
}

describe('self-discovered work on shared domain data', () => {
  it('preserves shared data and completed work when deleting producers and assigning a replacement', async () => {
    const f = mail()
    f.write('m1', { contentRevision: 'c1' })
    f.classify(() => ({ isInvoice: true }))
    const message = f.data.get('owner', 'acme/mail/messages/m1')
    const result = f.data.get('owner', 'acme/mail/classifications/m1')
    const history = f.store.db.prepare('SELECT * FROM data_entry_revisions ORDER BY namespace,key,revision').all()
    const retention = new DataRetention(f.store, 'unused-helper')
    for (const id of [f.sync, f.classifier]) {
      const pod = f.store.getPod(id)
      f.store.updatePod(id, pod.revision, { name: pod.name, lifecycle: 'archived' })
      await retention.deletePod(id, pod.revision + 1, pod.name)
    }

    expect(f.data.namespace('acme/mail/messages')).toMatchObject({ writer: 'owner', mode: 'records', readers: [f.invoices], writerEpoch: 2, revision: 2 })
    expect(f.data.namespace('acme/mail/classifications')).toMatchObject({ writer: 'owner', mode: 'results', readers: [f.invoices], writerEpoch: 2, revision: 2 })
    expect(f.data.get('owner', 'acme/mail/messages/m1')).toEqual(message)
    expect(f.data.get('owner', 'acme/mail/classifications/m1')).toEqual(result)
    expect(f.store.db.prepare('SELECT * FROM data_entry_revisions ORDER BY namespace,key,revision').all()).toEqual(history)
    const reader = f.run(f.invoices)
    expect(f.data.get(reader, 'acme/mail/classifications/m1')).toEqual(result)
    expect(f.work.find(reader, { operation: 'acme/invoice-review' })).toHaveLength(1)
    f.finish(reader)
    expect(() => f.data.set('owner', 'acme/mail/classifications/m1', { replaced: true }, 1)).toThrow('holds results')

    const replacement = f.pod('Replacement classifier', [classification()])
    f.data.setReaders('acme/mail/messages', [f.invoices, replacement], 2)
    f.data.assignWriter('acme/mail/classifications', replacement, 2)
    expect(f.classify(() => { throw new Error('Completed work must survive producer deletion') }, replacement)).toBe(0)
    f.data.set('owner', 'acme/mail/messages/m2', { contentRevision: 'c2' }, 0)
    expect(f.classify(() => ({ isInvoice: false }), replacement)).toBe(1)
    expect(f.store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('stores one negative result and repeats no analysis across ten scans and a restart', () => {
    const f = mail()
    f.write('m1', { contentRevision: 'c1', subject: 'Newsletter', categories: [] })
    expect(f.classify(() => ({ isInvoice: false }))).toBe(1)
    for (let scan = 0; scan < 10; scan++) expect(f.classify(() => { throw new Error('no model call expected') })).toBe(0)
    f.close()
    const restarted = workFixture(f.root)
    const run = restarted.run(f.classifier)
    expect(restarted.work.find(run, { operation: 'acme/mail-classification' })).toEqual([])
    expect(restarted.data.get(run, 'acme/mail/classifications/m1')!.value).toEqual({ isInvoice: false, contentRevision: 'c1' })
    expect(restarted.work.counts()['acme/mail-classification']!.completed).toBe(1)
  })

  it('keeps content analysis when only categories change and supersedes it when the content changes', () => {
    const f = mail()
    f.write('m1', { contentRevision: 'c1', categories: [] })
    expect(f.classify(() => ({ isInvoice: true }))).toBe(1)
    f.write('m1', { contentRevision: 'c1', categories: ['Rechnung'] })
    expect(f.classify(() => ({ isInvoice: true }))).toBe(0)
    f.write('m1', { contentRevision: 'c2', categories: ['Rechnung'] })
    expect(f.classify(() => ({ isInvoice: false }))).toBe(1)
    expect(f.data.get('owner', 'acme/mail/classifications/m1')!.value).toEqual({ isInvoice: false, contentRevision: 'c2' })
  })

  it('makes superseded work ready again when its input returns to the same fingerprint', () => {
    const f = mail()
    // Discovery runs on find; each scan between the writes records the input as it is at that moment.
    const scan = () => {
      const run = f.run(f.classifier); try { f.work.find(run, { operation: 'acme/mail-classification' }) }
      finally { f.finish(run) }
    }
    f.write('m1', { contentRevision: 'c1', categories: [] }); scan()
    f.write('m1', { contentRevision: 'c2', categories: [] }); scan()
    f.write('m1', { contentRevision: 'c1', categories: [] })
    expect(f.classify(() => ({ isInvoice: false }))).toBe(1)
    expect(f.data.get('owner', 'acme/mail/classifications/m1')!.value).toEqual({ isInvoice: false, contentRevision: 'c1' })
  })

  it('analyzes an input again when it returns to a version whose result was replaced meanwhile', () => {
    const f = mail()
    f.write('m1', { contentRevision: 'c1' })
    expect(f.classify(() => ({ isInvoice: true }))).toBe(1)
    f.write('m1', { contentRevision: 'c2' })
    expect(f.classify(() => ({ isInvoice: false }))).toBe(1)
    f.write('m1', { contentRevision: 'c1' })
    expect(f.classify(() => ({ isInvoice: true }))).toBe(1)
    expect(f.data.get('owner', 'acme/mail/classifications/m1')!.value).toEqual({ isInvoice: true, contentRevision: 'c1' })
    // Unchanged input finds nothing more to do.
    f.write('m1', { contentRevision: 'c1', categories: ['Rechnung'] })
    expect(f.classify(() => { throw new Error('no model call expected') })).toBe(0)
  })

  it('lets exactly one claimant win and fences the claim of an ended run', () => {
    const f = mail()
    f.write('m1', { contentRevision: 'c1' })
    const first = f.run(f.classifier)
    const [item] = f.work.find(first, { operation: 'acme/mail-classification' })
    const claim = f.work.claim(first, { key: item!.key })
    expect(() => f.work.claim(first, { key: item!.key })).toThrow('Work item is claimed')
    // The run ends without completing (a crash or a failure): its claim is released and its token completes nothing.
    f.finish(first, 'failed')
    f.store.db.prepare('UPDATE work_items SET ready_at=0').run()
    const second = f.run(f.classifier)
    expect(() => f.work.complete(first, { claimToken: claim.claimToken, result: { isInvoice: true } })).toThrow()
    const retaken = f.work.claim(second, { key: item!.key })
    expect(retaken.attempt).toBe(2)
    expect(() => f.work.complete(second, { claimToken: claim.claimToken, result: { isInvoice: true } })).toThrow('no longer held')
    f.work.complete(second, { claimToken: retaken.claimToken, result: { isInvoice: true } })
    expect(f.data.get('owner', 'acme/mail/classifications/m1')!.revision).toBe(1)
    // A Pod that is not the namespace writer cannot take the work at all.
    const outsider = f.pod('Classification copy', [classification()])
    f.data.setReaders('acme/mail/messages', [f.classifier, f.invoices, outsider], 1)
    f.finish(second)
    expect(() => f.work.find(f.run(outsider), { operation: 'acme/mail-classification' })).toThrow('not the writer')
  })

  it('rejects a result whose input changed while the work ran', () => {
    const f = mail()
    f.write('m1', { contentRevision: 'c1' })
    const run = f.run(f.classifier)
    const [item] = f.work.find(run, { operation: 'acme/mail-classification' })
    const claim = f.work.claim(run, { key: item!.key })
    f.write('m1', { contentRevision: 'c2' })
    expect(() => f.work.complete(run, { claimToken: claim.claimToken, result: { isInvoice: true } })).toThrow('changed while it ran')
    expect(f.data.get('owner', 'acme/mail/classifications/m1')).toBeNull()
    f.finish(run)
    expect(f.classify(() => ({ isInvoice: false }))).toBe(1)
  })

  it('serves consumers from results without naming the producer, also after the writer is replaced', () => {
    const f = mail()
    f.write('m1', { contentRevision: 'c1' }); f.write('m2', { contentRevision: 'c1' })
    f.classify(value => ({ isInvoice: value === null }))
    f.classify(() => ({ isInvoice: false }))
    // Replace the classifier: the new Pod becomes writer and serves the same contract; nothing is reprocessed.
    const replacement = f.pod('New classifier', [classification()])
    f.data.setReaders('acme/mail/messages', [f.classifier, replacement, f.invoices], 1)
    f.data.assignWriter('acme/mail/classifications', replacement, 1)
    expect(f.classify(() => { throw new Error('no reprocessing') }, replacement)).toBe(0)
    f.write('m3', { contentRevision: 'c1' })
    expect(f.classify(() => ({ isInvoice: true }), replacement)).toBe(1)
    const run = f.run(f.invoices)
    const found = f.work.find(run, { operation: 'acme/invoice-review' })
    expect(found.map(item => item.object)).toEqual(['m3'])
    // The retired writer can no longer write the namespace it gave up.
    const old = f.run(f.classifier)
    expect(() => f.work.find(old, { operation: 'acme/mail-classification' })).toThrow('not the writer')
  })

  it('reevaluates selected work after an explicit reprocess and never on activation alone', () => {
    const f = mail()
    f.write('m1', { contentRevision: 'c1' })
    f.classify(() => ({ isInvoice: false }))
    f.activate(f.classifier, [classification({ ruleVersions: [1, 2] })])
    expect(f.classify(() => ({ isInvoice: false }))).toBe(0)
    f.work.selectRule('acme/mail-classification', 2)
    expect(f.classify(() => ({ isInvoice: true }))).toBe(1)
    f.work.reprocess('acme/mail-classification')
    expect(f.classify(() => ({ isInvoice: true }))).toBe(1)
    // A changed contract is refused until the owner selects it.
    f.activate(f.classifier, [classification({ ruleVersions: [2], fields: ['contentRevision', 'subject'] })])
    expect(() => f.classify(() => ({}))).toThrow('selectRule')
    expect(() => f.work.selectRule('acme/mail-classification', 3)).toThrow('does not implement rule version 3')
    f.work.selectRule('acme/mail-classification', 2)
    // A claim taken before a reprocess cannot store its result over the newer generation.
    f.write('m2', { contentRevision: 'c2', subject: 'Second' })
    const run = f.run(f.classifier)
    try {
      const claim = f.work.claim(run, { key: f.work.find(run, { operation: 'acme/mail-classification' }).find(item => item.object === 'm2')!.key })
      f.work.reprocess('acme/mail-classification')
      expect(() => f.work.complete(run, { claimToken: claim.claimToken, result: { isInvoice: true } })).toThrow('the result was not stored')
    }
    finally { f.finish(run) }
  })

  it('skips idle scheduled runs of a work Pod but never those of a polling source', () => {
    const f = mail()
    f.classify(() => ({}))
    // Nothing is ready for the classifier, so its scheduled run is skipped.
    expect(f.work.pending(f.classifier)).toBe(false)
    // The same declaration on a source that polls an external system keeps its scheduled runs.
    f.activate(f.classifier, [classification()], true)
    expect(f.work.pending(f.classifier)).toBe(true)
  })

  it('waits for a missing prerequisite without new attempts, blocks repeated failures and lets the owner retry them', () => {
    const f = mail()
    f.write('m1', { contentRevision: 'c1' })
    let run = f.run(f.classifier)
    let [item] = f.work.find(run, { operation: 'acme/mail-classification' })
    f.work.defer(run, { claimToken: f.work.claim(run, { key: item!.key }).claimToken, reason: 'Attachments are not synchronized yet', until: Date.now() + 3_600_000 })
    expect(f.work.find(run, { operation: 'acme/mail-classification' })).toEqual([])
    expect(f.work.items('acme/mail-classification')[0]).toMatchObject({ state: 'waiting', reason: 'Attachments are not synchronized yet', attempt: 0 })
    f.finish(run)
    for (let attempt = 1; attempt <= 5; attempt++) {
      f.store.db.prepare('UPDATE work_items SET ready_at=0').run()
      run = f.run(f.classifier);
      [item] = f.work.find(run, { operation: 'acme/mail-classification' })
      f.work.fail(run, { claimToken: f.work.claim(run, { key: item!.key }).claimToken, reason: 'Model unavailable', retryable: true })
      f.finish(run)
    }
    const [blocked] = f.work.items('acme/mail-classification', ['blocked'])
    expect(blocked).toBeDefined()
    // Retrying failed work needs no owner observation (issue 1518).
    f.work.release(blocked!.key)
    expect(f.work.items('acme/mail-classification', ['retry_wait'])).toMatchObject([{ key: blocked!.key, reason: 'Retried by the owner' }])
    expect(() => f.work.release(blocked!.key)).toThrow('Only blocked or unknown work can be released')
  })

  it('retries the claims of a run that left an unknown external effect', () => {
    const f = mail()
    f.write('m1', { contentRevision: 'c1' })
    const run = f.run(f.classifier)
    const [item] = f.work.find(run, { operation: 'acme/mail-classification' })
    f.work.claim(run, { key: item!.key })
    f.store.db.prepare('INSERT INTO effect_attempts VALUES(?,1,?,?,\'mail.archive\',?,\'unknown\',\'{}\',?)').run('e'.repeat(64), f.classifier, run.runId, 'f'.repeat(64), Date.now())
    f.finish(run, 'failed')
    expect(f.work.items('acme/mail-classification', ['retry_wait'])).toHaveLength(1)
    f.store.db.prepare('UPDATE work_items SET ready_at=0').run()
    expect(f.classify(() => ({ isInvoice: true }))).toBe(1)
  })

  it('releases work an earlier version held for owner review, once, and keeps exhausted and restore-fenced work held', () => {
    const f = mail()
    for (const id of ['m1', 'm2', 'm3', 'm4']) f.write(id, { contentRevision: id })
    const run = f.run(f.classifier)
    const items = f.work.find(run, { operation: 'acme/mail-classification' })
    f.finish(run)
    const [unknown, written, exhausted, restored] = items.map(item => item.key)
    f.store.db.prepare('UPDATE work_items SET state=\'unknown\',reason=\'Restored backup: check whether this work was finished after the backup before releasing it\' WHERE key=?').run(restored)
    f.store.db.prepare('UPDATE work_items SET state=\'unknown\',reason=\'The run left an external action with an unknown outcome; reconcile it before this work continues\' WHERE key=?').run(unknown)
    f.store.db.prepare('UPDATE work_items SET state=\'blocked\',reason=\'The run changed an application before it ended; review what happened before this work continues\' WHERE key=?').run(written)
    f.store.db.prepare('UPDATE work_items SET state=\'blocked\',attempt=5,reason=\'Bad input\' WHERE key=?').run(exhausted)
    releaseHeldWork(f.store); releaseHeldWork(f.store)
    expect(f.work.items('acme/mail-classification', ['retry_wait']).map(item => item.key).sort()).toEqual([unknown, written].sort())
    expect(f.work.items('acme/mail-classification', ['blocked']).map(item => item.key)).toEqual([exhausted])
    expect(f.work.items('acme/mail-classification', ['unknown']).map(item => item.key)).toEqual([restored])
    expect(f.classify(() => ({ isInvoice: false }))).toBe(2)
  })

  it('keeps completion markers and results through backup and restore', async () => {
    const f = mail()
    f.write('m1', { contentRevision: 'c1' })
    f.classify(() => ({ isInvoice: false }))
    const exports = mkdtempSync(join(tmpdir(), 'pods-work-backup-'))
    const restored = workFixture(await restoreBackup(await createBackup(f.store, exports), exports, schemaVersion))
    // A restored profile resumes nothing until the owner confirmed the external actions since the backup.
    expect(() => restored.activate(f.classifier, [classification()])).toThrow('Restored profile')
    restored.store.db.prepare('INSERT INTO storage_receipts VALUES(\'review\',\'restore-reviewed\',\'{"evidence":"checked"}\',?)').run(Date.now() + 1)
    restored.activate(f.classifier, [classification()])
    const run = restored.run(f.classifier)
    expect(restored.work.find(run, { operation: 'acme/mail-classification' })).toEqual([])
    expect(restored.data.get(run, 'acme/mail/classifications/m1')!.value).toEqual({ isInvoice: false, contentRevision: 'c1' })
  })
})

describe('namespace ownership', () => {
  it('refuses unauthorized reads, neighboring prefixes, stale writes and forged results', () => {
    const f = mail()
    const outsider = f.pod('Outsider')
    f.data.define({ path: 'acme/mail/messages-archive', writer: f.sync, mode: 'records' })
    f.write('m1', { contentRevision: 'c1' })
    const run = f.run(outsider)
    expect(() => f.data.get(run, 'acme/mail/messages/m1')).toThrow('may not read')
    expect(() => f.data.list(run, 'acme/mail/messages')).toThrow('may not read')
    expect(() => f.data.define({ path: 'acme/mail/messages/inner', writer: outsider, mode: 'records' })).toThrow('inside another namespace')
    expect(() => f.data.get(run, 'acme/mail/messages-archive/../messages/m1')).toThrow()
    const sync = f.run(f.sync)
    expect(() => f.data.set(sync, 'acme/mail/messages/m1', { contentRevision: 'c9' }, 0)).toThrow('changed')
    expect(() => f.data.set(sync, 'acme/mail/classifications/m1', { isInvoice: true }, 0)).toThrow('Only the assigned writer')
    const classifier = f.run(f.classifier)
    expect(() => f.data.set(classifier, 'acme/mail/classifications/m1', { isInvoice: true }, 0)).toThrow('holds results')
  })

  it('validates namespace schemas and lists whole segments in key order', () => {
    const f = mail()
    f.data.define({ path: 'acme/policies', writer: 'owner', mode: 'records', schema: { required: ['sender'], types: { sender: 'string', count: ['integer'] } }, readers: [f.classifier] })
    expect(() => f.data.set('owner', 'acme/policies/a', { count: 1 }, 0)).toThrow('required field sender')
    expect(() => f.data.set('owner', 'acme/policies/a', { sender: 'x', count: 'many' }, 0)).toThrow('type string')
    for (const key of ['c', 'a', 'b']) f.data.set('owner', `acme/policies/${key}`, { sender: key }, 0)
    const run = f.run(f.classifier)
    const first = f.data.list(run, 'acme/policies', { limit: 2 })
    expect(first.entries.map(entry => entry.key)).toEqual(['acme/policies/a', 'acme/policies/b'])
    expect(f.data.list(run, 'acme/policies', { cursor: first.cursor, limit: 2 }).entries.map(entry => entry.key)).toEqual(['acme/policies/c'])
  })
})

describe('owner questions', () => {
  it('asks once per input, records the answer apart from the question and never overwrites another owner record', () => {
    const f = mail()
    f.data.define({ path: 'acme/mail/owner-answers', writer: 'owner', mode: 'records', readers: [f.classifier] })
    f.data.set('owner', 'acme/mail/owner-answers/policy', { senders: ['x@example.com'] }, 0)
    const run = f.run(f.classifier)
    const ask = (key: string, fingerprint: string) => f.questions.ask(run, { namespace: 'acme/mail/owner-answers', key, fingerprint, title: 'Newsletter?', body: '', options: [{ key: 'newsletter', title: 'Newsletter' }, { key: 'keep', title: 'Keep' }], data: { sender: 'a@example.com' } })
    const first = ask('m1', 'c1')
    expect(ask('m1', 'c1').id).toBe(first.id)
    // Asking again while it waits refreshes the presentation of the same question.
    expect(f.questions.ask(run, { namespace: 'acme/mail/owner-answers', key: 'm1', fingerprint: 'c1', title: 'Clearer?', body: 'Readable', options: [{ key: 'newsletter', title: 'Newsletter' }, { key: 'keep', title: 'Keep' }], data: { sender: 'a@example.com' } })).toMatchObject({ id: first.id, title: 'Clearer?', body: 'Readable', state: 'pending' })
    ask('m9', 'c1')
    expect(f.questions.withdraw(run, { namespace: 'acme/mail/owner-answers', key: 'm9' })).toEqual({ withdrawn: 1 })
    expect(f.questions.pending().map(item => item.key)).toEqual(['m1'])
    expect(() => ask('policy', 'c1')).toThrow('not an answer')
    f.questions.answer(first.id, 'keep')
    expect(f.data.get(run, 'acme/mail/owner-answers/m1')!.value).toMatchObject({ option: 'keep', fingerprint: 'c1', question: { podId: f.classifier, data: { sender: 'a@example.com' } } })
    expect(f.data.get(run, 'acme/mail/owner-answers/policy')!.value).toEqual({ senders: ['x@example.com'] })
    // A changed input asks again and supersedes nothing that was already decided.
    const second = ask('m1', 'c2')
    expect(second.id).not.toBe(first.id)
    expect(f.questions.get(first.id).state).toBe('decided')
    f.finish(run)
    // Another reader neither replaces this Pod's open question nor overwrites its answer.
    f.data.setReaders('acme/mail/owner-answers', [f.classifier, f.invoices], f.data.namespace('acme/mail/owner-answers').revision)
    const other = f.run(f.invoices)
    const foreign = (key: string, fingerprint: string) => f.questions.ask(other, { namespace: 'acme/mail/owner-answers', key, fingerprint, title: 'Mine?', body: '', options: [{ key: 'keep', title: 'Keep' }, { key: 'drop', title: 'Drop' }] })
    try {
      expect(() => foreign('m1', 'c3')).toThrow('Another Pod already asks')
      f.questions.answer(second.id, 'keep')
      expect(() => foreign('m1', 'c3')).toThrow('another Pod\'s question')
      expect(f.questions.get(second.id).state).toBe('decided')
    }
    finally { f.finish(other) }
  })
})
