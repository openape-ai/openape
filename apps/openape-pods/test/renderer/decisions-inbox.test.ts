import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApprovalHistoryView } from '../../src/contracts/approval-history'
import type { MapView } from '../../src/contracts/map-view'
import { parseMapView } from '../../src/contracts/map-view'
import DecisionsInbox from '../../src/renderer/central/DecisionsInbox.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import fixture from './map-view.json'

// The Entscheidungen surface from the 17 recorded mails the classification Pod asks the owner about, plus approvals,
// failed work and the fixture's rights.
const view = parseMapView(fixture) as MapView
const newsletters = view.pods.find(pod => pod.name === 'Newsletter-Prüfung')!
/** The 17 owner questions in the order they were asked. */
export const approvalHistory: ApprovalHistoryView = {
  approvals: [
    { id: '00000000-0000-4000-8000-0000000000a1', podId: newsletters.id, action: 'mail.archive', object: 'phofmann@delta-mind.at:n1', title: 'Spring sale at Shop', description: 'Newsletter: the sender offers an unsubscribe link', link: 'https://shop.example/newsletter/spring', state: 'requested', reason: null, batchId: 'batch-1', batchUrl: 'https://id.openape.ai/grant-batch?id=1', updatedAt: view.at },
    { id: '00000000-0000-4000-8000-0000000000a3', podId: newsletters.id, action: 'mail.archive', object: 'phofmann@delta-mind.at:n3', title: 'Archive mail from deals@shop.example', description: null, link: null, state: 'requested', reason: null, batchId: 'batch-1', batchUrl: 'https://id.openape.ai/grant-batch?id=1', updatedAt: view.at },
    { id: '00000000-0000-4000-8000-0000000000a4', podId: newsletters.id, action: 'mail.archive', object: 'phofmann@delta-mind.at:n4', title: 'Archive mail from digest@social.example', description: null, link: null, state: 'approved', reason: null, batchId: 'batch-1', batchUrl: 'https://id.openape.ai/grant-batch?id=1', updatedAt: view.at },
    { id: '00000000-0000-4000-8000-0000000000a2', podId: newsletters.id, action: 'mail.archive', object: 'phofmann@delta-mind.at:n2', title: 'Your SaaS digest', description: 'Weekly product digest', link: 'https://saas.example/digest', state: 'unknown', reason: 'Restored backup: the owner decision after the backup is unknown; request the approval again', batchId: null, batchUrl: null, updatedAt: view.at },
  ],
}
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; applyLanguage('en') })
async function mountInbox(props: Record<string, unknown> = {}) {
  applyLanguage('de')
  wrapper = mount(DecisionsInbox, { attachTo: document.body, props: { view, approvalHistory, desktop: true, ...props } })
  await flushPromises()
  return wrapper
}

describe('Entscheidungen', () => {
  it('lists approvals, rights and failed work with the exact owner commands', async () => {
    const monitor = view.pods.find(pod => pod.name === 'IURIO PR monitor')!
    const taskMonitor = view.pods.find(pod => pod.name === 'IURIO Task monitor')!
    await mountInbox()
    const approvals = wrapper!.find('[data-testid="approvals"]')
    expect(approvals.text()).toContain('Archive mail from deals@shop.example')
    // One batch request is one card with one decision link; approved members need nothing from the owner.
    const batch = approvals.find('[data-batch]')
    // Each object shows the fields the Pod's script gave (issue 1473): title, description and a link shown by its host.
    const claimed = batch.findAll('[data-approval]')[0]!
    expect(claimed.text()).toContain('Spring sale at Shop')
    expect(claimed.get('.approval-description').text()).toBe('Newsletter: the sender offers an unsubscribe link')
    expect(claimed.get('a').attributes()).toMatchObject({ href: 'https://shop.example/newsletter/spring', target: '_blank', rel: 'noopener noreferrer' })
    expect(claimed.get('a').text()).toBe('shop.example')
    expect(batch.findAll('[data-approval]')[1]!.find('a').exists()).toBe(false)
    expect(approvals.findAll('[data-batch]')).toHaveLength(1)
    expect(batch.findAll('button.idp')).toHaveLength(1)
    expect(batch.text()).toContain('3 Objekte in einer Sammelanfrage')
    expect(batch.text()).toContain('2 angefragt')
    expect(batch.text()).toContain('1 freigegeben')
    await approvals.find('button.idp').trigger('click')
    expect(wrapper!.emitted('approvalHistory')).toEqual([[{ type: 'openApproval', id: '00000000-0000-4000-8000-0000000000a1' }]])
    const uncertain = approvals.findAll('.item')[1]!
    expect(uncertain.text()).toContain('Your SaaS digest')
    expect(uncertain.get('.approval-description').text()).toBe('Weekly product digest')
    expect(uncertain.get('a').attributes('href')).toBe('https://saas.example/digest')
    expect(uncertain.findAll('button')).toHaveLength(0)
    expect(uncertain.text()).toContain('Historischer Eintrag')
    const rights = wrapper!.find('[data-testid="rights"]')
    expect(rights.text()).toContain('Execution permission for IURIO PR monitor')
    await rights.find('button').trigger('click')
    expect(wrapper!.emitted('command')).toEqual([[{ channel: 'runs', body: { type: 'openApproval', podId: monitor.id, runId: monitor.approvals[0]!.runId, grantId: 'grant-pr-monitor' } }]])
    // A grant the Pod requested at the IdP (for example through MCP) without a waiting run: title only, opened on this Mac.
    const grant = rights.find('[data-right="grant"]')
    expect(grant.text()).toContain('IURIO Task monitor')
    expect(grant.text()).toContain('Angefragtes Recht: Send Telegram messages to the IURIO channel')
    expect(grant.text()).not.toContain('grant-task-push')
    await grant.find('button.idp').trigger('click')
    expect(wrapper!.emitted('command')!.at(-1)).toEqual([{ channel: 'runs', body: { type: 'openGrant', podId: taskMonitor.id, grantId: 'grant-task-push' } }])
    expect(wrapper!.find('[data-testid="questions"]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid="failed-work"]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid="reconcile"]').exists()).toBe(false)
    expect(wrapper!.emitted('command')).toHaveLength(2)
  })

  it.each([true, false])('opens a requested approval on the correct host (desktop: %s)', async (desktop) => {
    await mountInbox({ desktop })
    const action = wrapper!.find('[data-testid="approvals"] .opts .idp')
    if (!desktop) {
      expect(action.element.tagName).toBe('A')
      expect(action.attributes()).toMatchObject({ href: 'https://id.openape.ai/grant-batch?id=1', target: '_blank', rel: 'noopener' })
      expect(wrapper!.emitted('approvalHistory')).toBeUndefined()
      return
    }
    expect(action.element.tagName).toBe('BUTTON')
  })

  it('links a requested Pod grant to its IdP page in the browser', async () => {
    await mountInbox({ approvalHistory: null, desktop: false, inboxUrl: '/inbox/' })
    const link = wrapper!.find('[data-testid="rights"] [data-right="grant"] a.idp')
    expect(link.attributes()).toMatchObject({ href: 'https://id.openape.ai/grant-approval?grant_id=grant-task-push', target: '_blank', rel: 'noopener' })
    // Without shared-data access the approvals and failed work live in the Pods inbox; the counters still show them.
    expect(wrapper!.find('[data-testid="approvals"]').text()).toContain('Rückfragen und Freigaben deiner Pods beantwortest du in der Pods-Inbox.')
    expect(wrapper!.findAll('.kpi')[0]!.find('b').text()).toBe('4')
  })

  it('lists open secret requests with the fill link, cancels them on the desktop and hides settled ones', async () => {
    const bot = view.pods.find(pod => pod.name === 'Morgenbriefing · Calendar-Bot')!
    const row = { podId: bot.id, alias: 'calendar_bot_token', purpose: '', expiresAt: view.at + 86400000, createdAt: view.at, updatedAt: view.at, error: null }
    await mountInbox({ requests: [{ ...row, id: '01REQ0', status: 'requested' }, { ...row, id: '01REQ1', status: 'failed', error: 'The envelope was collected elsewhere' }, { ...row, id: '01REQ2', status: 'collected' }, { ...row, id: '01REQ3', status: 'expired' }], secretsOrigin: 'https://secrets.openape.ai' })
    const items = wrapper!.findAll('[data-testid="secret-request"]')
    expect(items).toHaveLength(2)
    expect(items[0]!.text()).toContain('Geheimnis calendar_bot_token für Morgenbriefing · Calendar-Bot')
    expect(items[0]!.text()).toContain('ohne Zweckangabe'); expect(items[0]!.text()).toContain('gültig 24 h'); expect(items[0]!.text()).toContain('Anfrage 01REQ0')
    expect(items[0]!.find('a').attributes('href')).toBe('https://secrets.openape.ai')
    expect(items[1]!.text()).toContain('fehlgeschlagen'); expect(items[1]!.text()).toContain('Der Umschlag wurde anderswo abgeholt'); expect(items[1]!.find('a').exists()).toBe(false)
    const total = (wrapper!.vm as unknown as { total: number }).total
    await items[0]!.find('button').trigger('click')
    expect(wrapper!.emitted('secrets')).toEqual([[{ type: 'cancel', id: '01REQ0' }]])
    wrapper!.unmount()
    await mountInbox({ requests: [{ ...row, id: '01REQ0', status: 'requested' }], desktop: false })
    expect(wrapper!.find('[data-testid="secret-request"] button').attributes('disabled')).toBeDefined()
    expect((wrapper!.vm as unknown as { total: number }).total).toBe(total - 1)
  })
})
