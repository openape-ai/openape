import type { Plan, ReportDocument, TestRun } from './report-types'
import type { ResolvedEvidence } from './report-evidence'
import { germanPlan } from './plan-translations'
import { planLabel  } from './plan-labels'
import type { PlanLanguage } from './plan-labels'
import { invalid } from '@openape/report-contracts/html'
import { documentHtml, escapeHtml as e, items, markdown, masthead, meta } from './render-document'
import { externalLink, resolveReportEvidence } from './report-evidence'
import { runCommit, runResult, validateReport } from './report-input'

function block(title: string, body: string): string {
  return body ? `<section class="block"><h2>${e(title)}</h2>${body}</section>` : ''
}
function narrative(title: string, body?: string): string { return block(title, markdown(body)) }
function list(title: string, values?: string[]): string { return block(title, items(values ?? [])) }
function detail(title: string, body?: string): string { return body ? `<section class="detail"><h3>${e(title)}</h3>${markdown(body)}</section>` : '' }
function elapsedLabel(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
function approvalTarget(plan: Plan, language: PlanLanguage): string {
  const t = (value: string) => planLabel(language, value)
  const target = plan.approval?.target
  if (!target) return ''
  return `<dl>${target.revision ? `<dt>${t('Approved proposal revision')}</dt><dd>${target.revision}</dd>` : ''}${target.url ? `<dt>${t('Referenced artifact')}</dt><dd>${externalLink({ title: `Version ${target.version}`, url: target.url, version: target.version, digest: target.sourceDigest })}</dd>` : ''}${target.sourceDigest ? `<dt>${t('Recorded source SHA-256')}</dt><dd><code>${e(target.sourceDigest)}</code></dd>` : ''}</dl>`
}
function refs(ids: string[] | undefined, namespace: string): string {
  return ids?.length ? `<p class="small">${ids.map(id => `<a href="#${namespace}-${e(id)}">${e(id)}</a>`).join(' · ')}</p>` : ''
}
function targetRef(id?: string): string { return id ? refs([id], 'target') : '<p class="small">Target: not recorded</p>' }
function sectionSlots(doc: ReportDocument) {
  return {
    beforeDetails: (doc.sections ?? []).filter(item => item.placement === 'before-details').map(item => `<section id="section-${e(item.id)}" class="block"><h2>${e(item.title)}</h2>${markdown(item.body)}</section>`).join(''),
    afterDetails: (doc.sections ?? []).filter(item => item.placement !== 'before-details').map(item => `<section id="section-${e(item.id)}" class="block"><h2>${e(item.title)}</h2>${markdown(item.body)}</section>`).join(''),
  }
}

function common(doc: ReportDocument, evidence: ResolvedEvidence[]) {
  const images = (doc.evidence ?? []).filter(item => item.kind === 'image')
  return {
    language: e(doc.language ?? 'en'), title: e(doc.title),
    banner: doc.sample ? '<div class="sample-banner"><strong>Sample data</strong><span>Illustrative outcomes. This document is not verification evidence.</span></div>' : '',
    ...sectionSlots(doc),
    evidence: block('Evidence & references', `${images.length ? `<p class="small">${images.length} images · ${images.filter(item => item.inspection).length} inspection attestations recorded. Roles and inspection state are shown for each image.</p>` : ''}${evidence.map(item => `<section class="evidence-item" id="evidence-${e(item.id)}">${item.html}</section>`).join('')}`),
    targets: block('Targets', (doc.targets ?? []).map(target => `<section class="card" id="target-${e(target.id)}"><h3>${e(target.label)}</h3><p class="small">${e(target.id)} · ${e(target.kind)}</p><dl>${Object.entries(target).filter(([key]) => !['id', 'label', 'kind', 'notes'].includes(key)).map(([key, value]) => `<dt>${e(key)}</dt><dd>${e(String(value))}</dd>`).join('')}</dl>${markdown(target.notes)}</section>`).join('')),
    references: block('References & source lineage', `${(doc.links ?? []).map(link => `<p>${externalLink(link)}</p>`).join('')}${(doc.provenance ?? []).map(item => `<section><p>${externalLink({ ...item, title: item.format })}</p>${items(item.notes ?? [])}</section>`).join('')}`),
  }
}

function commands(run: TestRun): string {
  return block('Commands observed', (run.commands ?? []).map(command => `<section class="command" id="command-${e(command.id)}"><pre><code>${e(command.command)}</code></pre><div class="command-side"><span class="status">${command.outcome === 'exited' ? `exit ${command.exitCode}` : e(command.outcome)}</span>${command.durationMs !== undefined ? `<span>${command.durationMs} ms</span>` : ''}</div><div class="command-note">${targetRef(command.targetId)}${command.cwd ? `<p>Working directory: <code>${e(command.cwd)}</code></p>` : ''}${command.expectedExitCodes ? `<p>Expected exits: ${command.expectedExitCodes.join(', ')}</p>` : ''}${meta([command.startedAt, command.finishedAt])}${markdown(command.summary)}${refs(command.evidenceIds, 'evidence')}</div></section>`).join(''))
}

function checks(run: TestRun): string {
  const order = { failed: 0, blocked: 1, skipped: 2, passed: 3 }
  return [...run.tests].sort((a, b) => order[a.status] - order[b.status]).map((check) => {
    const imageIds = new Set([...(check.evidenceIds ?? []), ...(check.steps ?? []).flatMap(step => step.evidenceIds ?? [])].filter(id => run.evidence?.some(item => item.id === id && item.kind === 'image' && item.role === 'evidence')))
    return `<details class="test" id="check-${e(check.id)}"${check.status !== 'passed' ? ' open' : ''}><summary><span class="test-name">${e(check.title)}</span>${imageIds.size ? `<span class="chip">${imageIds.size} evidence images</span>` : ''}<span class="pill ${check.status === 'passed' ? 'pass' : check.status === 'failed' ? 'fail' : ''}">${e(check.status)}</span><span class="chevron">›</span></summary><div class="test-body">${markdown(check.description)}${targetRef(check.targetId)}${detail('Expected', check.expected)}${detail('Observed', check.observed)}${detail('Reason', check.reason)}${check.error ? `<div class="error">${markdown(check.error)}</div>` : ''}${refs(check.commandIds, 'command')}${refs(check.evidenceIds, 'evidence')}${(check.steps ?? []).map(step => `<section><div class="step"><strong>${e(step.title)}</strong>${step.status ? `<span class="status">${e(step.status)}</span>` : ''}</div>${markdown(step.caption)}${refs(step.commandIds, 'command')}${refs(step.evidenceIds, 'evidence')}</section>`).join('')}</div></details>`
  }).join('')
}

function runSlots(run: TestRun) {
  const result = runResult(run)
  const illustrative = run.sample || run.purpose === 'reference'
  const label = illustrative ? `${run.sample ? 'Sample' : 'Reference'} document` : result === 'failed' ? 'Checks failed' : result === 'incomplete' ? 'Verification incomplete' : 'All recorded checks passed'
  const counts = ['passed', 'failed', 'skipped', 'blocked'].map(status => `<span><b>${run.tests.filter(check => check.status === status).length}</b> ${status}</span>`).join('')
  const elapsed = run.startedAt && run.finishedAt ? elapsedLabel(Date.parse(run.finishedAt) - Date.parse(run.startedAt)) : 'Duration: not recorded'
  return {
    masthead: masthead('Test Runs'), eyebrow: e(`${run.purpose} report`), lead: markdown(run.summary), meta: meta([run.project, run.series]),
    state: `<section class="state ${illustrative ? 'neutral' : result === 'passed' ? 'ok' : result === 'incomplete' ? 'warn' : ''}"><div class="state-head"><div><strong>${label}</strong><p>${illustrative ? 'Recorded outcomes are not product acceptance.' : 'This summary describes recorded checks; the assessment below is a separate conclusion.'}</p></div></div><div class="counts">${counts}</div><dl class="facts"><div><dt>Run interval</dt><dd>${e(run.startedAt ?? 'Not recorded')} — ${e(run.finishedAt ?? 'Not recorded')}</dd></div><div><dt>Duration</dt><dd>${elapsed}</dd></div></dl></section>`,
    scope: run.scope ? block('Scope', `<div class="pair"><div class="card"><h3>Covered</h3>${items(run.scope.covered ?? [])}</div><div class="card"><h3>Not covered</h3>${items(run.scope.excluded ?? [])}</div></div>`) : '',
    commands: commands(run), details: checks(run),
    assessment: run.assessment ? block(illustrative ? 'Illustrative assessment' : 'Assessment', `<p class="status">${e(run.assessment.outcome)}</p>${markdown(run.assessment.summary)}${refs(run.assessment.evidenceIds, 'evidence')}`) : block('Assessment', '<p>Not recorded. Check results alone do not establish readiness or safety.</p>'),
    limitations: `${run.limitations?.length ? block('Limitations', `<div class="limits">${items(run.limitations)}</div>`) : ''}${narrative('Next step', run.nextStep)}`,
  }
}

export function approvalLabel(plan: Plan): string {
  const target = plan.approval?.target
  if (!plan.approval) return 'Owner approval: not recorded'
  if (!target) return 'Decision recorded · approval target unverified'
  if (target.revision !== undefined && plan.revision !== undefined && target.revision !== plan.revision) return 'Other proposal revision approved · current revision not covered'
  if (target.sourceDigest || target.url) return 'Decision recorded for a referenced artifact · current-source equivalence unverified'
  if (target.revision === plan.revision && plan.revision !== undefined) return 'Approval recorded for this proposal revision'
  return 'Decision recorded · approval target unverified'
}

function planSlots(plan: Plan, language: PlanLanguage = 'en', sourceLanguage = plan.language ?? 'en') {
  const t = (value: string) => planLabel(language, value)
  const approval = plan.approval
  const original = (value?: string) => value ? `<div lang="${e(sourceLanguage)}">${markdown(value)}</div>` : ''
  const originalDetail = (title: string, value?: string) => value ? `<section class="detail"><h3>${e(title)}</h3>${original(value)}</section>` : ''
  return {
    masthead: masthead('Plans'), eyebrow: t('Implementation plan'), lead: markdown(plan.goal), meta: meta([plan.project, plan.owner, plan.date, `${t('Status')}: ${t(plan.status)}`, plan.revision ? `${t('Proposal revision')} ${plan.revision}` : undefined]),
    tldr: plan.summary ? `<section class="plan-tldr" aria-label="TL;DR"><h2>TL;DR</h2>${markdown(plan.summary)}</section>` : '',
    problem: plan.problem ? `<section class="problem-overview" aria-labelledby="problem-heading"><h2 id="problem-heading">${t('Problem at a glance')}</h2><ol>${(['statement', 'impact', 'approach', 'outcome'] as const).map((key, index) => `<li><span class="problem-stage">${index + 1} · ${t(['Problem', 'Impact', 'Approach', 'Outcome'][index]!)}</span>${markdown(plan.problem![key])}</li>`).join('')}</ol></section>` : '',
    milestoneHeading: t('Milestones'),
    foot: t('Content and inspection attestations are supplied by the author. The renderer does not execute checks or verify the author\'s identity.'),
    state: `<section class="state neutral"><div class="state-head"><div><strong>${t(approvalLabel(plan))}</strong><p>${t('A lifecycle status does not grant approval.')}</p></div></div>${approval ? `<div class="card"><p>${e(approval.by)} · ${e(approval.date)}</p><h3>${t('Original approval statement')}</h3>${original(approval.reference)}${originalDetail(t('Approval scope (original wording)'), approval.scope)}${approvalTarget(plan, language)}</div>` : ''}</section>`,
    context: narrative(t('Context & problem'), plan.context),
    scope: plan.scope?.length || plan.nonGoals?.length ? block(t('Scope'), `<div class="pair"><div class="card"><h3>${t('Included')}</h3>${items(plan.scope ?? [])}</div><div class="card"><h3>${t('Out of scope')}</h3>${items(plan.nonGoals ?? [])}</div></div>`) : '',
    decisions: block(t('Decisions'), [...(plan.decisions ?? [])].sort((a, b) => Number(b.status === 'proposed') - Number(a.status === 'proposed')).map(item => `<section class="decision-row"><span class="status">${e(t(item.status))}</span><div><h3>${e(item.title)}</h3>${markdown(item.description)}${meta([item.by, item.date])}${originalDetail(t('Decision reference (original wording)'), item.reference)}</div></section>`).join('')),
    progress: `${plan.milestones.filter(item => item.status === 'done').length} ${t('of')} ${plan.milestones.length} ${t('complete')}`,
    details: plan.milestones.map((item, index) => `<details class="milestone ${item.status}" id="milestone-${e(item.id)}"${item.status === 'blocked' || item.status === 'active' || index === 0 ? ' open' : ''}><summary><span class="milestone-number">${index + 1}</span><span class="test-name">${e(item.title)}</span><span class="status">${e(t(item.status))}</span><span class="chevron">›</span></summary><div class="milestone-body">${markdown(item.goal)}${items(item.steps ?? [])}<div class="proof"><strong>${t('Accepted when')}</strong>${items(item.acceptance)}</div>${detail(t('Blocker'), item.blocker)}${detail(t('Evidence'), item.proof)}${refs(item.evidenceIds, 'evidence')}${detail(t('Rollback'), item.rollback)}</div></details>`).join(''),
    completion: plan.completion ? block(t('Completion outcome'), `<p class="status">${e(t(plan.completion.result))}</p>${markdown(plan.completion.summary)}${refs(plan.completion.evidenceIds, 'evidence')}`) : plan.status === 'done' ? block(t('Completion outcome'), `<p>${t('Not assessed. Completed work does not imply an achieved outcome.')}</p>`) : '',
    risks: block(t('Risks & tradeoffs'), (plan.risks ?? []).map(item => `<div class="risk-row"><strong>${e(item.title)}</strong>${markdown(item.mitigation)}</div>`).join('')),
    rollback: block(t('Rollback summary'), `<dl class="rollback">${plan.milestones.map(item => `<dt>${e(item.id)}</dt><dd>${item.rollback ? markdown(item.rollback) : t('Not recorded')}</dd>`).join('')}</dl>`),
    verification: list(t('Verification'), plan.verification), handoff: narrative(t('Handoff & next action'), plan.handoff),
    history: block(t('Changelog'), (plan.changelog ?? []).map(item => `<p><strong>${e(item.date)}</strong> · ${e(item.text)}</p>`).join('')),
  }
}

export function renderVersioned(input: unknown, kind: 'plan' | 'test-run', directory: string, templateDirectory?: string) {
  const doc = validateReport(input)
  if ((kind === 'plan') !== (doc.schema === 'openape.plan/2')) invalid(`Wrong schema for ${kind}`)
  const evidence = resolveReportEvidence(doc, directory)
  const metadata: Record<string, string> = {}
  if (doc.schema === 'openape.plan/2') {
    metadata['plans.status'] = doc.status
  }
  else if (!doc.sample && doc.purpose !== 'reference') {
    metadata['tests.result'] = runResult(doc)
    const commit = runCommit(doc)
    if (commit) metadata['tests.commit'] = commit
  }
  const slots = { ...common(doc, evidence), ...(doc.schema === 'openape.plan/2' ? planSlots(doc) : runSlots(doc)) }
  const german = doc.schema === 'openape.plan/2' && doc.translations ? germanPlan(doc) : undefined
  const alternate = german ? { ...common(german, evidence), ...planSlots(german, 'de', doc.language ?? 'en') } : undefined
  if (german && doc.sample) slots.banner = '<div class="sample-banner"><strong><span lang="de">Beispieldaten</span> / <span lang="en">Sample data</span></strong><span lang="de">Illustrative Inhalte, keine Prüfnachweise.</span><span lang="en">Illustrative content, not verification evidence.</span></div>'
  return { html: documentHtml(kind, doc.title, '', metadata, doc, templateDirectory, slots, alternate, doc.schema === 'openape.plan/2' ? doc.translations?.defaultLanguage ?? 'de' : undefined), evidence }
}
