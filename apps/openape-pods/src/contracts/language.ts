export type Language = 'de' | 'en'
export type LanguageCommand = { type: 'get' } | { type: 'set', language: Language }
export function parseLanguage(value: unknown): Language {
  if (value !== 'de' && value !== 'en') throw new Error('Unsupported language')
  return value
}
export function parseLanguageCommand(value: unknown): LanguageCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid language command')
  const command = value as Record<string, unknown>
  if (command.type === 'get' && Object.keys(command).length === 1) return { type: 'get' }
  if (command.type === 'set' && Object.keys(command).length === 2) return { type: 'set', language: parseLanguage(command.language) }
  throw new Error('Invalid language command')
}
export function systemLanguage(locale: string): Language {
  return /^de(?:[-_]|$)/i.test(locale) ? 'de' : 'en'
}
