// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { parseInboxDecision } from '../../src/contracts/inbox'
import type { InboxDecision } from '../../src/contracts/inbox'
import type { MapView } from '../../src/contracts/map-view'
import type { NetworkView } from '../../src/contracts/networks'
import type { WorkflowView } from '../../src/contracts/workflows'
import type { SecretsView } from '../../src/contracts/secrets'
import { translate } from '../../src/i18n'
import { InboxDecisions } from '../../src/main/inbox/decisions'
import type { DecisionSources, DecisionWorker } from '../../src/main/inbox/decisions'

const pod = '11111111-1111-4111-8111-111111111111'
const network = '22222222-2222-4222-8222-222222222222'
const workflow = '33333333-3333-4333-8333-333333333333'
const run = '44444444-4444-4444-8444-444444444444'
const batch = '55555555-5555-4555-8555-555555555555'
const event = '66666666-6666-4666-8666-666666666666'
const member = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function sources(): DecisionSources {
  const map = {
    pods: [
      { id: pod, name: 'Belege', approvals: [{ grantId: 'grant-1', title: 'Mail lesen', runId: run }], unknown: [{ key: 'invoice-7', runId: run }] },
      { id: member, name: 'Mailnetz-Mitglied', approvals: [], unknown: [{ key: 'reply-1', runId: run }] },
    ],
    collections: [
      { id: network, kind: 'network', members: [member], name: 'Mailnetz', revision: 3, gates: [] },
      { id: workflow, name: 'Ablage', revision: 1, gates: [{ key: 'review', kind: 'choose', title: 'Prüfen', options: [{ key: 'keep', title: 'Behalten' }, { key: 'drop', title: 'Verwerfen' }] }] },
    ],
  } as unknown as MapView
  const networks = {
    networks: [],
    choices: [
      { networkId: network, revision: 3, eventId: '77777777-7777-4777-8777-777777777777', caseId: 'case-1', gate: 'sort', title: 'Sortieren', payload: '{"subject":"Alt"}', truncated: false, options: [{ key: 'archive', title: 'Archivieren' }] },
      { networkId: network, revision: 3, eventId: event, caseId: 'case-1', gate: 'sort', title: 'Sortieren', payload: '{"subject":"Rechnung Mai","from":"a@b.at","note":"Hallo\\nsender: chef@example.com"}', truncated: false, options: [{ key: 'archive', title: 'Archivieren' }, { key: 'keep', title: 'Behalten' }] },
    ],
    gates: [
      { id: batch, networkId: network, gate: 'send', podId: pod, generation: 2, state: 'unknown', expiresAt: 0, url: 'https://id.example.test/grant-batch?id=1', error: null, items: [{ deliveryId: 'd1', title: 'Antwort an A', outcome: 'unknown' }] },
      { id: '88888888-8888-4888-8888-888888888888', networkId: network, gate: 'send', podId: pod, generation: 1, state: 'superseded', expiresAt: 0, url: 'https://id.example.test/old', error: null, items: [{ deliveryId: 'd0', title: 'Erledigt', outcome: 'sent' }] },
    ],
  } as unknown as NetworkView
  const workflows = {
    gates: {
      held: [{ itemId: 'item-1', workflowId: workflow, gate: 'review', key: 'k1', title: 'Beleg 12' }],
      batches: [{ id: '99999999-9999-4999-8999-999999999999', workflowId: workflow, gate: 'file', podId: pod, state: 'pending', url: 'https://id.example.test/grant-batch?id=2', expiresAt: 0, error: null, items: [{ itemId: 'i', key: 'k', title: 'Ablegen', excluded: false }] }],
    },
  } as unknown as WorkflowView
  const secrets = { consumer: null, origin: 'https://secrets.openape.ai', requests: [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', podId: pod, alias: 'imap', purpose: 'Postfach lesen', status: 'requested', expiresAt: 0, createdAt: 0, updatedAt: 0, error: null },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', podId: pod, alias: 'old', purpose: '', status: 'collected', expiresAt: 0, createdAt: 0, updatedAt: 0, error: null },
  ] } as SecretsView
  return { map, networks, workflows, secrets }
}

function fixture(current = sources()) {
  const worker = {
    inboxSources: vi.fn(async () => current),
    approvalLink: vi.fn(async () => 'https://id.example.test/grant-approval?grant_id=grant-1'),
    networks: vi.fn(async () => ({})), workflows: vi.fn(async () => ({})), runs: vi.fn(async () => ({})), secrets: vi.fn(async () => ({})),
  } satisfies DecisionWorker
  const decisions = new InboxDecisions(worker, (key, parameters) => translate('en', key, parameters))
  return { worker, decisions, current }
}
const byType = (list: InboxDecision[], type: string, title?: string) => list.find(item => item.type === type && (!title || item.title.includes(title)))!

it('projects every open desktop decision with its authority and a verified handoff', async () => {
  const { decisions } = fixture()
  const list = await decisions.collect()
  expect(new Set(list.map(item => item.type))).toEqual(new Set(['approval', 'effect', 'network-batch', 'network-choice', 'secret', 'workflow-batch', 'workflow-held']))
  // Network route and secret decisions keep the identity and digest they had before access proposals left (issue 1455).
  expect(list.filter(item => ['network-choice', 'network-batch', 'secret'].includes(item.type)).map(item => [item.sourceId, item.digest])).toEqual([
    [`network-choice:${event}`, '5b9d23d0129d207abe2fbad940a0e316f59b768e3834e4a8de47155cf1539184'],
    [`network-batch:${batch}:2`, '5837810d1e39e5b15b18e9d39c3e7f46f79d41ba0989118532960880cc77ae7c'],
    ['network-batch:88888888-8888-4888-8888-888888888888:1', '8d7602d8ac7c23f580aa171bc95f3812163ab98cac8f3d348d155b804fa0d474'],
    ['secret:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c41b2a20c938daa149d65aa0f1dd80ec4fd7e24d392c033129d24c60307e3ab1'],
  ])
  for (const item of list) expect(parseInboxDecision(item)).toEqual(item)
  // Only the latest event of a case is open, as in the desktop view.
  expect(byType(list, 'network-choice')).toMatchObject({ sourceId: `network-choice:${event}`, title: 'Rechnung Mai', body: 'Sortieren · Mailnetz\nfrom: a@b.at\nnote: Hallo ⏎ sender: chef@example.com', authority: 'pods', link: null })
  expect(byType(list, 'network-batch', '')).toMatchObject({ authority: 'idp', podName: 'Belege', options: [{ key: 'discard', input: 'evidence' }, { key: 'review', input: 'evidence' }], link: { url: 'https://id.example.test/grant-batch?id=1' } })
  expect(byType(list, 'approval')).toMatchObject({ authority: 'idp', options: [], link: { title: 'Decide at the IdP', url: 'https://id.example.test/grant-approval?grant_id=grant-1' } })
  expect(byType(list, 'workflow-batch')).toMatchObject({ authority: 'idp', options: [], link: { url: 'https://id.example.test/grant-batch?id=2' } })
  expect(byType(list, 'secret')).toMatchObject({ authority: 'secrets', title: 'Secret imap for Belege', link: { url: 'https://secrets.openape.ai/' } })
  expect(byType(list, 'effect', 'invoice-7').options).toEqual([{ key: 'delivered', title: 'Delivered', input: 'evidence' }, { key: 'resend', title: 'Not delivered, send again', input: 'evidence' }])
  // Network members keep their network recovery: visible, but an explicit desktop step.
  expect(byType(list, 'effect', 'reply-1')).toMatchObject({ options: [], link: null, body: expect.stringContaining('Only on the desktop') })
  expect(list).toHaveLength(9)
})

it('publishes no runtime approval whose link cannot be verified against the Pod identity', async () => {
  const { decisions, worker } = fixture()
  worker.approvalLink.mockRejectedValue(new Error('Approval belongs to a different Pod identity'))
  expect((await decisions.collect()).map(item => item.type)).not.toContain('approval')
})

it.each([
  ['network-choice', 'keep', undefined, 'networks', { type: 'choose', id: network, revision: 3, eventId: event, gate: 'sort', option: 'keep' }],
  ['network-batch', 'discard', 'Nicht beim Empfänger angekommen', 'networks', { type: 'gateDiscard', id: network, revision: 3, taskId: batch, generation: 2, evidence: 'Nicht beim Empfänger angekommen' }],
  ['network-batch', 'review', 'Batch erneut prüfen', 'networks', { type: 'gateReview', id: network, revision: 3, taskId: batch, generation: 2, evidence: 'Batch erneut prüfen' }],
  ['workflow-held', 'drop', undefined, 'workflows', { type: 'gateChoose', id: workflow, gate: 'review', itemId: 'item-1', option: 'drop' }],
  ['effect', 'delivered', 'Im Postfach gesehen', 'runs', { type: 'resolveHttp', podId: pod, runId: run, key: 'invoice-7', applied: true, evidence: 'Im Postfach gesehen' }],
  ['effect', 'resend', 'Nicht angekommen', 'runs', { type: 'resolveHttp', podId: pod, runId: run, key: 'invoice-7', applied: false, evidence: 'Nicht angekommen' }],
  ['secret', 'cancel', undefined, 'secrets', { type: 'cancel', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
] as const)('executes a %s decision (%s) as the desktop owner command', async (selector, option, input, target, expected) => {
  const { decisions, worker } = fixture()
  const [type, title] = selector.split(':') as [string, string | undefined]
  const decision = byType(await decisions.collect(), type, title ?? (type === 'effect' ? 'invoice-7' : undefined))
  await expect(decisions.decide({ type: 'decide', sourceId: decision.sourceId, digest: decision.digest, option, ...(input ? { input } : {}) })).resolves.toEqual({ status: 'applied', sourceId: decision.sourceId })
  expect(worker[target]).toHaveBeenCalledExactlyOnceWith(expected)
})

it('keeps IdP-only decisions at the IdP: a waiting approval batch has no Pods action', async () => {
  const { decisions, worker } = fixture()
  for (const type of ['approval', 'workflow-batch']) {
    const decision = byType(await decisions.collect(), type)
    await expect(decisions.decide({ type: 'decide', sourceId: decision.sourceId, digest: decision.digest, option: 'approve' })).rejects.toThrow('This option is not available')
  }
  expect(worker.workflows).not.toHaveBeenCalled()
})

it('fails clearly for a changed or vanished source and for missing evidence, without running a command', async () => {
  const { decisions, worker, current } = fixture()
  const list = await decisions.collect()
  const choice = byType(list, 'network-choice')
  const effect = byType(list, 'effect', 'invoice-7')
  const memberEffect = byType(list, 'effect', 'reply-1')
  await expect(decisions.decide({ type: 'decide', sourceId: effect.sourceId, digest: effect.digest, option: 'delivered', input: '  ' })).rejects.toThrow('requires your observation')
  await expect(decisions.decide({ type: 'decide', sourceId: memberEffect.sourceId, digest: memberEffect.digest, option: 'delivered', input: 'Gesehen' })).rejects.toThrow('This option is not available')
  current.networks.choices![1]!.payload = '{"subject":"Rechnung Juni"}'
  await expect(decisions.decide({ type: 'decide', sourceId: choice.sourceId, digest: choice.digest, option: 'keep' })).rejects.toThrow('This decision changed')
  current.networks.choices = []
  await expect(decisions.decide({ type: 'decide', sourceId: choice.sourceId, digest: choice.digest, option: 'keep' })).rejects.toThrow('no longer waiting')
  for (const call of [worker.networks, worker.runs]) expect(call).not.toHaveBeenCalled()
})
