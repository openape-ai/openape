import de from '../i18n/de.json'
import { ref } from 'vue'
import { parseLanguage } from '../contracts/language'
import type { Language } from '../contracts/language'
import { translate, translateDiagnostic } from '../i18n'
import type { MessageKey, Parameters } from '../i18n'

export const language = ref<Language>('en')
export function applyLanguage(value: Language): void {
  language.value = parseLanguage(value)
  document.documentElement.lang = value
}
export function t(key: MessageKey, parameters?: Parameters): string { return translate(language.value, key, parameters) }
export function diagnostic(value: string | null | undefined): string { return translateDiagnostic(language.value, value) }
export function label(value: string | null | undefined): string { return value && Object.hasOwn(de, value) ? t(value as MessageKey) : value ?? '' }
export function dateTime(value: string | number): string { return new Intl.DateTimeFormat(language.value === 'de' ? 'de-AT' : 'en-GB', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value)) }
export function number(value: number, digits?: number): string { return new Intl.NumberFormat(language.value === 'de' ? 'de-AT' : 'en-GB', digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value) }
