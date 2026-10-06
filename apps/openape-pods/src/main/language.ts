import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseLanguage, systemLanguage } from '../contracts/language'
import type { Language } from '../contracts/language'

export class LanguagePreference {
  language: Language
  readonly path: string
  constructor(readonly root: string, locale: string) {
    this.path = join(root, 'language.json')
    try { this.language = parseLanguage(JSON.parse(readFileSync(this.path, 'utf8'))) }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      this.language = systemLanguage(locale)
    }
  }

  set(value: Language): Language {
    const language = parseLanguage(value)
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    writeFileSync(`${this.path}.tmp`, JSON.stringify(language), { mode: 0o600 })
    renameSync(`${this.path}.tmp`, this.path)
    this.language = language
    return language
  }
}
