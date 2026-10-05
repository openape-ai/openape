export interface ChoiceFields { headline: string, fields: [name: string, value: string][] }

const headlineKeys = ['subject', 'title', 'name']
const maxFields = 8
const maxValue = 200

/**
 * The readable part of a choice payload: a headline and its plain top-level fields.
 * Null when the payload is not a complete JSON object with such fields; the card then shows it raw.
 */
export function choiceFields(payload: string): ChoiceFields | null {
  let parsed: unknown
  try { parsed = JSON.parse(payload) }
  catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const plain = Object.entries(parsed).flatMap(([name, value]): [string, string][] => {
    if (!['string', 'number', 'boolean'].includes(typeof value) || value === '') return []
    const text = String(value)
    if (/^[a-f0-9]{32,}$/i.test(text)) return []
    return [[name, text.length > maxValue ? `${text.slice(0, maxValue - 1)}…` : text]]
  })
  const headlineKey = headlineKeys.find(key => plain.some(([name]) => name === key))
  const fields = plain.filter(([name]) => name !== headlineKey).slice(0, maxFields)
  const headline = plain.find(([name]) => name === headlineKey)?.[1] ?? ''
  return headline || fields.length ? { headline, fields } : null
}
