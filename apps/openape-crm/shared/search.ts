import type { Phase } from './pipelines'
import { PIPELINES, stufe } from './pipelines'

export interface SearchHit {
  typ: 'Vorgang' | 'Person' | 'Firma'
  id: string
  label: string
  sub: string
}

export function suche(q: string, data: {
  vorgaenge: {
    id: string
    titel: string
    phase: Phase
    stufe: string
    firma: string
    personen: string[]
    emails: string[]
    historie: string[]
  }[]
  personen: { id: string, name: string, email: string }[]
  firmen: { id: string, name: string, ort: string }[]
}): SearchHit[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  const hits: SearchHit[] = []
  for (const v of data.vorgaenge) {
    const hay = [v.titel, v.firma, ...v.personen, ...v.emails, ...v.historie].join(' ').toLowerCase()
    if (!hay.includes(s)) continue
    const stage = stufe(v.phase, v.stufe)
    hits.push({
      typ: 'Vorgang',
      id: v.id,
      label: v.titel,
      sub: `${PIPELINES[v.phase].label} · ${stage?.label ?? v.stufe}`,
    })
  }
  for (const p of data.personen) {
    if (!`${p.name} ${p.email}`.toLowerCase().includes(s)) continue
    hits.push({ typ: 'Person', id: p.id, label: p.name, sub: p.email })
  }
  for (const f of data.firmen) {
    if (!f.name.toLowerCase().includes(s)) continue
    hits.push({ typ: 'Firma', id: f.id, label: f.name, sub: f.ort })
  }
  return hits.slice(0, 12)
}
