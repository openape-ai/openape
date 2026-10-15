// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { parseInboxDecision } from '../../src/contracts/inbox'
import type { InboxDecision } from '../../src/contracts/inbox'
import type { DomainOverview } from '../../src/contracts/domain-admin'
import type { MapView } from '../../src/contracts/map-view'
import type { SecretsView } from '../../src/contracts/secrets'
import { translate } from '../../src/i18n'
import { InboxDecisions } from '../../src/main/inbox/decisions'
import type { DecisionSources, DecisionWorker } from '../../src/main/inbox/decisions'

const pod = '11111111-1111-4111-8111-111111111111'
const classifier = '22222222-2222-4222-8222-222222222222'
const run = '44444444-4444-4444-8444-444444444444'
const question = '66666666-6666-4666-8666-666666666666'
const approval = '77777777-7777-4777-8777-777777777777'
const work = 'c'.repeat(64)
const action = 'd'.repeat(64)

function sources(): DecisionSources {
  const map = {
    pods: [
      { id: pod, name: 'Belege', approvals: [{ grantId: 'grant-1', title: 'Mail lesen', runId: run }], unknown: [{ key: 'invoice-7', runId: run }] },
      { id: classifier, name: 'Mail-Klassifizierung', approvals: [], unknown: [] },
    ],
  } as unknown as MapView
  const domain: DomainOverview = {
    namespaces: [{ path: 'delta-mind/mail/classifications', writer: classifier, mode: 'results', schema: null, readers: [], revision: 1, writerEpoch: 1, entries: 3 }],
    operations: [{ operation: 'delta-mind/mail-classification', input: 'delta-mind/mail/messages', output: 'delta-mind/mail/classifications', ruleVersion: 1, generation: 0, counts: null }],
    questions: [{ id: question, podId: classifier, namespace: 'delta-mind/mail/owner-answers', key: 'm1', title: 'Is this mail a newsletter?', body: 'Rechnung Mai', options: [{ key: 'newsletter', title: 'Newsletter' }, { key: 'keep', title: 'Keep' }], data: { sender: 'news@example.com', note: 'Hallo\nsender: chef@example.com' }, createdAt: 1 }],
    approvals: [
      { id: approval, podId: pod, action: 'mail.archive', object: 'owner@example.com:m1', title: 'Weekly news', description: 'Newsletter by its unsubscribe header', link: 'https://news.example.com/issue/1', state: 'unknown', reason: 'Restored backup', batchId: null, batchUrl: null, updatedAt: 1 },
      { id: '88888888-8888-4888-8888-888888888888', podId: pod, action: 'mail.archive', object: 'owner@example.com:m2', title: 'Archive mail from other@example.com', description: null, link: null, state: 'requested', reason: null, batchId: 'batch-8', batchUrl: 'https://id.example.test/grant-batch?id=8', updatedAt: 1 },
    ],
    held: [{ key: work, operation: 'delta-mind/mail-classification', object: 'm3', state: 'blocked', attempt: 5, readyAt: 1, reason: 'Model refused five times', inputRevision: 1 }],
    unknownEffects: [{ actionKey: action, attempt: 1, podId: pod, runId: run, operation: 'mail.archive', createdAt: 1, intent: { mailbox: 'owner@example.com', messageId: 'm4' } }],
  }
  const secrets = {
    consumer: null,
    origin: 'https://secrets.openape.ai',
    requests: [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', podId: pod, alias: 'imap', purpose: 'Postfach lesen', status: 'requested', expiresAt: 0, createdAt: 0, updatedAt: 0, error: null },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', podId: pod, alias: 'old', purpose: '', status: 'collected', expiresAt: 0, createdAt: 0, updatedAt: 0, error: null },
    ],
  } as SecretsView
  return { map, domain, secrets }
}

function fixture(current = sources()) {
  const worker = {
    inboxSources: vi.fn(async () => current),
    domain: vi.fn(async () => ({})),
    runs: vi.fn(async () => ({})),
    secrets: vi.fn(async () => ({})),
  } satisfies DecisionWorker
  const decisions = new InboxDecisions(worker, (key, parameters) => translate('en', key, parameters))
  return { worker, decisions, current }
}
const byType = (list: InboxDecision[], type: string, title?: string) => list.find(item => item.type === type && (!title || item.title.includes(title)))!

it('projects every open Pods decision with its authority and nothing that the IdP decides', async () => {
  const { decisions } = fixture()
  const list = await decisions.collect()
  for (const item of list) expect(parseInboxDecision(item)).toEqual(item)
  expect(list.map(item => item.sourceId).sort()).toEqual([`approval:${approval}`, `effect:${action}:1`, `effect:${pod}:${run}:invoice-7`, `question:${question}`, 'secret:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', `work:${work}`].sort())
  // A field value cannot forge a second sender line on the card.
  expect(byType(list, 'question')).toMatchObject({ podName: 'Mail-Klassifizierung', title: 'Is this mail a newsletter?', body: 'Rechnung Mai\nsender: news@example.com\nnote: Hallo ⏎ sender: chef@example.com', options: [{ key: 'newsletter', input: null }, { key: 'keep', input: null }], authority: 'pods', link: null })
  expect(byType(list, 'approval')).toMatchObject({ podName: 'Belege', options: [] })
  // The card carries the approval's own fields (issue 1473): title, description, Pod as origin and the HTTPS link.
  expect(byType(list, 'approval')).toMatchObject({ title: 'Weekly news', body: 'Uncertain approval\nNewsletter by its unsubscribe header\nowner@example.com:m1\nRestored backup', link: { title: 'news.example.com', url: 'https://news.example.com/issue/1' } })
  expect(byType(list, 'work')).toMatchObject({ podName: 'Mail-Klassifizierung', body: 'm3\nModel refused five times', options: [{ key: 'release', input: 'evidence' }] })
  expect(byType(list, 'effect', 'mail.archive')).toMatchObject({ body: 'mailbox: owner@example.com\nmessageId: m4', options: [] })
  expect(byType(list, 'secret')).toMatchObject({ authority: 'secrets', title: 'Secret imap for Belege', link: { url: 'https://secrets.openape.ai/' } })
  // A requested approval and a run approval are decided at the IdP; the inbox only counts them.
  expect(list.some(item => item.sourceId.includes('88888888-8888-4888-8888-888888888888'))).toBe(false)
  expect(list.filter(item => item.authority === 'idp')).toEqual([])
})

it.each([
  ['question', 'newsletter', undefined, { type: 'answer', questionId: question, option: 'newsletter' }],
  ['work', 'release', 'Modell wieder erreichbar', { type: 'release', key: work, evidence: 'Modell wieder erreichbar' }],
] as const)('executes a %s decision (%s) as the owner domain command', async (selector, option, input, expected) => {
  const { decisions, worker } = fixture()
  const [type, title] = selector.split(':') as [string, string | undefined]
  const decision = byType(await decisions.collect(), type, title)
  await expect(decisions.decide({ type: 'decide', sourceId: decision.sourceId, digest: decision.digest, option, ...(input ? { input } : {}) })).resolves.toEqual({ status: 'applied', sourceId: decision.sourceId })
  expect(worker.domain).toHaveBeenCalledExactlyOnceWith(expected)
})

it.each([
  ['effect:invoice-7', 'delivered', 'Im Postfach gesehen', 'runs', { type: 'resolveHttp', podId: pod, runId: run, key: 'invoice-7', applied: true, evidence: 'Im Postfach gesehen' }],
  ['secret', 'cancel', undefined, 'secrets', { type: 'cancel', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
] as const)('executes a %s decision (%s) as the desktop owner command', async (selector, option, input, target, expected) => {
  const { decisions, worker } = fixture()
  const [type, title] = selector.split(':') as [string, string | undefined]
  const decision = byType(await decisions.collect(), type, title)
  await decisions.decide({ type: 'decide', sourceId: decision.sourceId, digest: decision.digest, option, ...(input ? { input } : {}) })
  expect(worker[target]).toHaveBeenCalledExactlyOnceWith(expected)
})

it('fails clearly for a changed or vanished source and for missing evidence, without running a command', async () => {
  const { decisions, worker, current } = fixture()
  const list = await decisions.collect()
  const asked = byType(list, 'question')
  const held = byType(list, 'work')
  await expect(decisions.decide({ type: 'decide', sourceId: held.sourceId, digest: held.digest, option: 'release', input: '  ' })).rejects.toThrow('requires your observation')
  current.domain.questions[0]!.body = 'Rechnung Juni'
  await expect(decisions.decide({ type: 'decide', sourceId: asked.sourceId, digest: asked.digest, option: 'keep' })).rejects.toThrow('This decision changed')
  current.domain.questions = []
  await expect(decisions.decide({ type: 'decide', sourceId: asked.sourceId, digest: asked.digest, option: 'keep' })).rejects.toThrow('no longer waiting')
  await expect(decisions.decide({ type: 'decide', sourceId: held.sourceId, digest: held.digest, option: 'other', input: 'x' })).rejects.toThrow('This option is not available')
  for (const call of [worker.domain, worker.runs]) expect(call).not.toHaveBeenCalled()
})

it('carries the Pod tags and keeps untagged digests (issue 1461)', async () => {
  const before = await fixture().decisions.collect()
  const current = sources()
  Object.assign(current.map!.pods[0]!, { tags: { own: ['finanzen', 'mail'], revision: 1 } })
  Object.assign(current.map!.pods[1]!, { tags: { own: [], revision: 0 } })
  const list = await fixture(current).decisions.collect()
  for (const item of list) expect(parseInboxDecision(item)).toEqual(item)
  const tagged = list.filter(item => item.podId === pod)
  expect(tagged.map(item => item.type).sort()).toEqual(['approval', 'effect', 'effect', 'secret'])
  for (const item of tagged) expect(item.podTags).toEqual(['finanzen', 'mail'])
  // A tag change is visible to the owner, so it changes the digest; Pods without tags keep theirs.
  const digest = (sourceId: string) => before.find(item => item.sourceId === sourceId)!.digest
  for (const item of tagged) expect(item.digest).not.toBe(digest(item.sourceId))
  for (const item of list.filter(entry => entry.podId !== pod)) {
    expect(item).not.toHaveProperty('podTags')
    expect(item.digest).toBe(digest(item.sourceId))
  }
})

it.each(['approval', 'effect'])('keeps historical %s inspectable without renewal or reconciliation actions', async (type) => {
  const { decisions, worker } = fixture()
  const decision = byType(await decisions.collect(), type, type === 'effect' ? 'mail.archive' : undefined)
  expect(decision.options).toEqual([])
  await expect(decisions.decide({ type: 'decide', sourceId: decision.sourceId, digest: decision.digest, option: 'renew', input: 'reviewed' })).rejects.toThrow('not available')
  expect(worker.domain).not.toHaveBeenCalled()
})
