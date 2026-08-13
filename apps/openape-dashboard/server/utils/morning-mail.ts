/**
 * Pure rendering for the morning briefing mail — deterministic, zero tokens.
 * Reuses the board's display logic (labels, tones, ordering, rest contract)
 * and the sanitizing markdown renderer, so mail and dashboard never drift.
 */
import { renderMarkdown } from '../../app/utils/markdown'
import {
  doneSummary,
  formatValue,
  missingRest,
  themeGroups,
  topScope,
  totalWaiting,
} from '../../app/utils/kpi-display'
import type { KpiRow } from '../database/schema'

export interface MorningMail {
  subject: string
  text: string
  html: string
}

const AMBER = '#fbbf24'
const GREEN = '#34d399'
const MUTED = '#71717a'

export function buildMorningMail(kpis: KpiRow[], dateLabel: string, dashboardUrl: string): MorningMail {
  if (kpis.length === 0) {
    return {
      subject: 'Dein Briefing — nichts Neues',
      text: `${dateLabel}\n\nKeine neuen Kennzahlen in den letzten 24 Stunden.\n\n${dashboardUrl}`,
      html: `<div style="font-family:-apple-system,system-ui,sans-serif;max-width:640px;margin:0 auto;padding:16px">
<p style="color:${MUTED};margin:0">${esc(dateLabel)}</p>
<h1 style="font-size:22px;margin:4px 0 16px">Nichts Neues <span style="color:${GREEN}">✓</span></h1>
<p>Keine neuen Kennzahlen in den letzten 24&nbsp;Stunden — entweder war nichts, oder die Producer melden sich nicht. Ein Blick ins <a href="${esc(dashboardUrl)}">Dashboard</a> zeigt den letzten Stand.</p>
</div>`,
    }
  }

  const groups = themeGroups(kpis)
  const total = totalWaiting(kpis)
  const done = doneSummary(kpis)

  const subject = total > 0
    ? `Dein Briefing — ${total} Punkte warten`
    : 'Dein Briefing — alles versorgt'

  const textLines = [dateLabel, '']
  const htmlCards: string[] = []
  for (const group of groups) {
    const color = group.tone === 'attention' ? AMBER : group.tone === 'done' ? GREEN : '#e4e4e7'
    textLines.push(`${group.label}: ${group.total}${group.unit ? ` ${group.unit}` : ''}`)

    const memberBlocks: string[] = []
    for (const kpi of group.members) {
      const scopeLabel = kpi.link
        ? `<a href="${esc(kpi.link)}" style="color:${MUTED}">${esc(topScope(kpi.scope).toUpperCase())}</a>`
        : esc(topScope(kpi.scope).toUpperCase())
      const value = `${formatValue(kpi)}${kpi.unit ? ` ${kpi.unit}` : ''}`
      textLines.push(`  ${topScope(kpi.scope)}: ${value}`)
      let body = ''
      if (kpi.detail && kpi.value > 0) {
        const rendered = renderMarkdown(kpi.detail)
        const missing = missingRest(kpi.value, rendered)
        const rest = missing > 0
          ? `<p style="font-style:italic;color:${MUTED};margin:4px 0 0">${kpi.link ? `<a href="${esc(kpi.link)}" style="color:${MUTED}">… und ${missing} weitere</a>` : `… und ${missing} weitere`}</p>`
          : ''
        body = `<div style="font-size:14px;margin-top:4px">${rendered}${rest}</div>`
      }
      const zero = kpi.value === 0 ? ` <span style="color:${GREEN};font-size:12px">nichts wartet ✓</span>` : ''
      memberBlocks.push(`<div style="margin-top:8px"><span style="font-size:11px;letter-spacing:1px;color:${MUTED}">${scopeLabel}</span> <strong style="color:${kpi.value > 0 ? color : GREEN}">${esc(value)}</strong>${zero}${body}</div>`)
    }

    htmlCards.push(`<div style="border:1px solid ${group.tone === 'attention' ? AMBER : '#d4d4d8'};border-radius:10px;padding:12px 14px;margin:0 0 10px">
<div><span style="font-weight:500">${esc(group.label)}</span>
<span style="float:right;font-size:20px;font-weight:600;color:${color}">${group.total}${group.unit ? ` <span style="font-size:12px">${esc(group.unit)}</span>` : ''}</span></div>
${memberBlocks.join('\n')}</div>`)
  }

  const doneLine = done.length
    ? `<p style="color:${GREEN};font-size:14px;margin:0 0 16px">Versorgt: ${esc(done.join(' · '))}</p>`
    : ''

  const html = `<div style="font-family:-apple-system,system-ui,sans-serif;max-width:640px;margin:0 auto;padding:16px;color:#18181b">
<p style="color:${MUTED};margin:0">${esc(dateLabel)}</p>
<h1 style="font-size:22px;margin:4px 0 12px">${total > 0 ? `<span style="color:${AMBER}">${total} Punkte</span> warten` : `Alles versorgt <span style="color:${GREEN}">✓</span>`}</h1>
${doneLine}
${htmlCards.join('\n')}
<p style="margin-top:16px;font-size:13px;color:${MUTED}"><a href="${esc(dashboardUrl)}" style="color:${MUTED}">Zum Dashboard</a> — dort ist immer der aktuelle Stand.</p>
</div>`

  textLines.push('', dashboardUrl)
  return { subject, text: textLines.join('\n'), html }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
