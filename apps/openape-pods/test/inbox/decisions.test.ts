// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { parseInboxDecision } from '../../src/contracts/inbox'
import type { InboxDecision } from '../../src/contracts/inbox'
import type { ApprovalHistoryView } from '../../src/contracts/approval-history'
import type { MapView } from '../../src/contracts/map-view'
import type { SecretsView } from '../../src/contracts/secrets'
import { translate } from '../../src/i18n'
import { InboxDecisions } from '../../src/main/inbox/decisions'
import type { DecisionSources, DecisionWorker } from '../../src/main/inbox/decisions'

const pod = '11111111-1111-4111-8111-111111111111'
const classifier = '22222222-2222-4222-8222-222222222222'
const run = '44444444-4444-4444-8444-444444444444'
const approval = '77777777-7777-4777-8777-777777777777'

function sources(): DecisionSources {
  const map = {
    pods: [
      { id: pod, name: 'Belege', approvals: [{ grantId: 'grant-1', title: 'Mail lesen', runId: run }] },
      { id: classifier, name: 'Mail-Klassifizierung', approvals: [] },
    ],
  } as unknown as MapView
  const approvalHistory: ApprovalHistoryView = {
    approvals: [
      { id: approval, podId: pod, action: 'mail.archive', object: 'owner@example.com:m1', title: 'Weekly news', description: 'Newsletter by its unsubscribe header', link: 'https://news.example.com/issue/1', state: 'unknown', reason: 'Restored backup', batchId: null, batchUrl: null, updatedAt: 1 },
      { id: '88888888-8888-4888-8888-888888888888', podId: pod, action: 'mail.archive', object: 'owner@example.com:m2', title: 'Archive mail from other@example.com', description: null, link: null, state: 'requested', reason: null, batchId: 'batch-8', batchUrl: 'https://id.example.test/grant-batch?id=8', updatedAt: 1 },
    ],
  }
  const secrets = {
    consumer: null,
    origin: 'https://secrets.openape.ai',
    requests: [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', podId: pod, alias: 'imap', purpose: 'Postfach lesen', status: 'requested', expiresAt: 0, createdAt: 0, updatedAt: 0, error: null },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', podId: pod, alias: 'old', purpose: '', status: 'collected', expiresAt: 0, createdAt: 0, updatedAt: 0, error: null },
    ],
  } as SecretsView
  return { map, approvalHistory, secrets }
}

function fixture(current = sources()) {
  const worker = {
    inboxSources: vi.fn(async () => current),
    approvalHistory: vi.fn(async () => ({})),
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
  expect(list.map(item => item.sourceId).sort()).toEqual([`approval:${approval}`, 'secret:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'].sort())
  // A field value cannot forge a second sender line on the card.
  expect(byType(list, 'approval')).toMatchObject({ podName: 'Belege', options: [] })
  // The card carries the approval's own fields (issue 1473): title, description, Pod as origin and the HTTPS link.
  expect(byType(list, 'approval')).toMatchObject({ title: 'Weekly news', body: 'Uncertain approval\nNewsletter by its unsubscribe header\nowner@example.com:m1\nRestored backup', link: { title: 'news.example.com', url: 'https://news.example.com/issue/1' } })
  // Failed work is retried without an owner observation; Pods holds nothing for review (issue 1518).
  expect(byType(list, 'secret')).toMatchObject({ authority: 'secrets', title: 'Secret imap for Belege', link: { url: 'https://secrets.openape.ai/' } })
  // A requested approval and a run approval are decided at the IdP; the inbox only counts them.
  expect(list.some(item => item.sourceId.includes('88888888-8888-4888-8888-888888888888'))).toBe(false)
  expect(list.filter(item => item.authority === 'idp')).toEqual([])
})

it.each([
  ['secret', 'cancel', undefined, 'secrets', { type: 'cancel', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
] as const)('executes a %s decision (%s) as the desktop owner command', async (selector, option, input, target, expected) => {
  const { decisions, worker } = fixture()
  const [type, title] = selector.split(':') as [string, string | undefined]
  const decision = byType(await decisions.collect(), type, title)
  await decisions.decide({ type: 'decide', sourceId: decision.sourceId, digest: decision.digest, option, ...(input ? { input } : {}) })
  expect(worker[target]).toHaveBeenCalledExactlyOnceWith(expected)
})

it('carries the Pod tags and keeps untagged digests (issue 1461)', async () => {
  const before = await fixture().decisions.collect()
  const current = sources()
  Object.assign(current.map!.pods[0]!, { tags: { own: ['finanzen', 'mail'], revision: 1 } })
  Object.assign(current.map!.pods[1]!, { tags: { own: [], revision: 0 } })
  const list = await fixture(current).decisions.collect()
  for (const item of list) expect(parseInboxDecision(item)).toEqual(item)
  const tagged = list.filter(item => item.podId === pod)
  expect(tagged.map(item => item.type).sort()).toEqual(['approval', 'secret'])
  for (const item of tagged) expect(item.podTags).toEqual(['finanzen', 'mail'])
  // A tag change is visible to the owner, so it changes the digest; Pods without tags keep theirs.
  const digest = (sourceId: string) => before.find(item => item.sourceId === sourceId)!.digest
  for (const item of tagged) expect(item.digest).not.toBe(digest(item.sourceId))
  for (const item of list.filter(entry => entry.podId !== pod)) {
    expect(item).not.toHaveProperty('podTags')
    expect(item.digest).toBe(digest(item.sourceId))
  }
})

it('keeps a historical approval inspectable without renewal or reconciliation actions', async () => {
  const { decisions, worker } = fixture()
  const decision = byType(await decisions.collect(), 'approval')
  expect(decision.options).toEqual([])
  await expect(decisions.decide({ type: 'decide', sourceId: decision.sourceId, digest: decision.digest, option: 'renew', input: 'reviewed' })).rejects.toThrow('not available')
  expect(worker.approvalHistory).not.toHaveBeenCalled()
})
