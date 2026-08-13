import { describe, expect, it } from 'vitest'
import { buildMorningMail } from '../server/utils/morning-mail'
import type { KpiRow } from '../server/database/schema'

const DASH = 'https://dashboard.openape.ai'

function kpi(partial: Partial<KpiRow>): KpiRow {
  return {
    id: 'x',
    owner: 'patrick@hofmann.eco',
    scope: 'delta-mind',
    key: 'mail.attention',
    value: 1,
    unit: 'mails',
    detail: null,
    link: null,
    source: 'human',
    createdAt: Date.now(),
    ...partial,
  }
}

describe('buildMorningMail', () => {
  it('renders the nichts-Neues mail when no fresh KPIs exist', () => {
    const mail = buildMorningMail([], 'Donnerstag, 13. August', DASH)
    expect(mail.subject).toBe('Dein Briefing — nichts Neues')
    expect(mail.html).toContain('Dashboard')
    expect(mail.text).toContain('Keine neuen Kennzahlen')
  })

  it('sums waiting points into the subject and renders sections with links', () => {
    const mail = buildMorningMail([
      kpi({ id: '1', value: 3, detail: '- **A** — [Betreff](https://outlook.office.com/x) (08:00)', link: 'https://outlook.office.com/mail/' }),
      kpi({ id: '2', scope: 'tasks', key: 'tasks.open', value: 17, unit: 'offen', detail: '- Task A\n- _+16 weitere_', link: 'https://tasks.openape.ai' }),
      kpi({ id: '3', scope: 'dev/openape', key: 'dev.prs_merged_24h', value: 2, unit: null, detail: '- [#1](https://git.openape.ai/x) t' }),
    ], 'Donnerstag, 13. August', DASH)
    expect(mail.subject).toBe('Dein Briefing — 20 Punkte warten')
    expect(mail.html).toContain('Mails, die Aufmerksamkeit brauchen')
    expect(mail.html).toContain('href="https://outlook.office.com/x"')
    expect(mail.html).toContain('href="https://tasks.openape.ai"')
    expect(mail.html).toContain('Versorgt:')
    expect(mail.text).toContain('Offene Tasks: 17 offen')
  })

  it('enforces the rest contract in the mail like the board does', () => {
    const mail = buildMorningMail([
      kpi({ value: 10, detail: '- **A** — x (08:00)\n- **B** — y (09:00)' }),
    ], 'Donnerstag, 13. August', DASH)
    expect(mail.html).toContain('… und 8 weitere')
  })

  it('collapses empty done-KPIs instead of rendering their placeholder detail', () => {
    const mail = buildMorningMail([
      kpi({ value: 0, detail: '_Inbox leer — nichts wartet._' }),
    ], 'Donnerstag, 13. August', DASH)
    expect(mail.subject).toBe('Dein Briefing — alles versorgt')
    expect(mail.html).not.toContain('Inbox leer')
    expect(mail.html).toContain('Versorgt: delta-mind leer')
  })

  it('escapes untrusted strings in scope/unit and sanitizes detail html', () => {
    const mail = buildMorningMail([
      kpi({ scope: 'a<b', unit: 'x<img>', detail: '<script>alert(1)</script>- ok' }),
    ], 'Donnerstag, 13. August', DASH)
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('A&lt;B')
  })
})
