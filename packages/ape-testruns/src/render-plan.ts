import { renderVersioned } from './render-versioned'
import type { PlanDocument } from './render-types'
import { validatePlan } from './plan-input'
import { documentHtml, escapeHtml as e, items, markdown, masthead, meta } from './render-document'

function decisions(plan: PlanDocument): string {
  if (!plan.decisions.length) return ''
  return `<section class="decision"><div class="decision-label">Decisions</div>${plan.decisions.map(item => `<div class="decisions"><h2>${e(item.title)}</h2><p class="small">${e(item.status)}${item.by ? ` · ${e(item.by)}` : ''}${item.date ? ` · ${e(item.date)}` : ''}</p>${markdown(item.description)}</div>`).join('')}</section>`
}

function milestones(plan: PlanDocument): string {
  return plan.milestones.map((item, index) => `<details class="milestone"${item.status === 'active' || item.status === 'blocked' || index === 0 ? ' open' : ''}><summary><span class="milestone-number">${String(index + 1).padStart(2, '0')}</span><span class="test-name">${e(item.title)}</span><span class="status">${e(item.status)}</span><span class="chevron">›</span></summary><div class="milestone-body">${markdown(item.goal)}${items(item.steps)}<div class="proof"><strong>Accepted when</strong>${items(item.acceptance)}</div>${item.proof ? `<h3>Evidence</h3>${markdown(item.proof)}` : ''}${item.rollback ? `<h3>Rollback</h3>${markdown(item.rollback)}` : ''}</div></details>`).join('')
}

export function renderPlan(input: unknown, templateDirectory?: string, directory = '.'): string {
  if (input && typeof input === 'object' && 'schema' in input && input.schema === 'openape.plan/2') return renderVersioned(input, 'plan', directory, templateDirectory).html
  const plan = validatePlan(input)
  const complete = plan.milestones.filter(item => item.status === 'done').length
  const approval = plan.approval ? `<dt>Decision by</dt><dd>${e(plan.approval.by)}</dd><dt>Decision date</dt><dd>${e(plan.approval.date)}</dd><dt>Approved reference</dt><dd>${e(plan.approval.reference)}</dd>` : '<dt>Owner approval</dt><dd>Not recorded</dd>'
  const content = `${masthead('Plans')}<main class="page"><div class="eyebrow">Implementation plan</div><h1>${e(plan.title)}</h1><div class="lead markdown">${markdown(plan.goal)}</div>${meta([plan.project, plan.date, plan.owner, plan.status])}${plan.context ? `<section class="markdown">${markdown(plan.context)}</section>` : ''}${decisions(plan)}<div class="columns"><section><div class="section-heading"><h2>Milestones</h2><span class="small">${complete} of ${plan.milestones.length} complete</span></div>${milestones(plan)}<div class="scope"><section><h3>Included</h3>${items(plan.scope)}</section><section><h3>Out of scope</h3>${items(plan.nonGoals)}</section></div>${plan.verification.length ? `<section><h2>Verification</h2>${items(plan.verification)}</section>` : ''}</section><aside><section><h3>Approval</h3><dl><dt>Plan status</dt><dd>${e(plan.status)}</dd>${approval}</dl><p class="approval-note">A plan status is not an approval. Decisions are recorded separately.</p></section>${plan.risks.length ? `<section><h3>Risks & tradeoffs</h3>${plan.risks.map(risk => `<div class="risk"><strong>${e(risk.title)}</strong>${markdown(risk.mitigation)}</div>`).join('')}</section>` : ''}${plan.links.length ? `<section><h3>References</h3>${plan.links.map(link => `<p><a href="${e(link.url)}" rel="noopener noreferrer">${e(link.title)}</a></p>`).join('')}</section>` : ''}</aside></div>${plan.changelog.length ? `<section class="changelog"><h2>Changelog</h2>${plan.changelog.map(entry => `<p><strong>${e(entry.date)}</strong> · ${e(entry.text)}</p>`).join('')}</section>` : ''}</main>`
  return documentHtml('plan', plan.title, content, { 'plans.status': plan.status }, plan, templateDirectory)
}
