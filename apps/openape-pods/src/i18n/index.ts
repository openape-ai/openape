import { diagnosticPatterns } from './diagnostics'
import de from './de.json'
import type { Language } from '../contracts/language'

export type MessageKey = keyof typeof de
export type Parameters = Record<string, string | number>
export function translate(language: Language, key: MessageKey, parameters: Parameters = {}): string {
  const message = language === 'de' ? de[key] : key
  return message.replace(/\{(\w+)\}/g, (_match, name: string) => {
    if (!(name in parameters)) throw new Error(`Missing translation parameter: ${name}`)
    return String(parameters[name])
  })
}
export function translateDiagnostic(language: Language, value: string | null | undefined): string {
  if (!value) return ''
  const message = value.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
  if (Object.hasOwn(de, message)) return translate(language, message as MessageKey)
  for (const key of diagnosticPatterns) {
    const parts = key.split(/(\{\w+\})/g)
    const names: string[] = []
    const pattern = parts.map((part) => {
      if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1, -1)); return '([\\s\\S]*?)' }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }).join('')
    const match = new RegExp(`^${pattern}$`).exec(message)
    if (match) return translate(language, key, Object.fromEntries(names.map((name, index) => [name, match[index + 1]])))
  }
  return language === 'en' ? message : `Technische Meldung (Original): ${message}`
}
