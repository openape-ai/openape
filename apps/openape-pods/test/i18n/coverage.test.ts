import { parse as parseSFC } from 'vue/compiler-sfc'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type * as TypeScript from 'typescript'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import de from '../../src/i18n/de.json'
import { diagnosticPatterns } from '../../src/i18n/diagnostics'
import { translateDiagnostic } from '../../src/i18n'

const ts = createRequire(import.meta.url)('typescript') as typeof TypeScript

function files(directory: string): string[] { return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]) }
it('covers every first-party static thrown diagnostic and parameterized error template', () => {
  const missing: string[] = []
  for (const path of files('src').filter(path => path.endsWith('.ts') && !path.includes('/i18n/'))) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    function visit(node: TypeScript.Node): void {
      if (ts.isNewExpression(node) && ['Error', 'TypeError'].includes(node.expression.getText(source))) {
        const argument = node.arguments?.[0]
        if (argument && ts.isStringLiteral(argument) && !Object.hasOwn(de, argument.text)) missing.push(`${path}: ${argument.text}`)
        if (argument && ts.isTemplateExpression(argument)) {
          const key = argument.head.text + argument.templateSpans.map((span, index) => `{p${index}}${span.literal.text}`).join('')
          if (!(diagnosticPatterns as readonly string[]).includes(key)) missing.push(`${path}: ${key}`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  expect(missing).toEqual([])
})
it('translates known diagnostic frames while preserving variable paths, provider details and braces', () => {
  expect(translateDiagnostic('de', 'Database schema 99 needs a newer application')).toBe('Datenbankschema 99 benötigt eine neuere Anwendung')
  expect(translateDiagnostic('de', 'Mail read failed (403): {message}\nRaw provider response')).toBe('Mail-Lesezugriff fehlgeschlagen (403): {message}\nRaw provider response')
  expect(translateDiagnostic('de', 'File changed during backup: /tmp/{path}/A.txt')).toBe('Datei wurde während der Sicherung geändert: /tmp/{path}/A.txt')
})
it('keeps the German and English handbooks complete with the same chapters, steps and executable example', () => {
  const english = JSON.parse(readFileSync('docs/handbook.json', 'utf8')); const german = JSON.parse(readFileSync('docs/handbook.de.json', 'utf8'))
  expect(german.sections.map((section: { id: string }) => section.id)).toEqual(english.sections.map((section: { id: string }) => section.id))
  for (let index = 0; index < english.sections.length; index++) {
    const en = english.sections[index]; const translated = german.sections[index]
    expect(translated.paragraphs.length, en.id).toBe(en.paragraphs.length); expect(translated.steps.length, en.id).toBe(en.steps.length)
    expect(translated.code, en.id).toBe(en.code)
    expect(translated.paragraphs.every((text: string) => text.length > 10), en.id).toBe(true)
    if (en.image) expect(translated.image).toBe(en.image.replace('.png', '-de.png'))
  }
})

it('routes visible template copy and accessible labels through the catalog', () => {
  const missing: string[] = []
  for (const path of files('src/renderer').filter(path => path.endsWith('.vue'))) {
    function visit(value: unknown): void {
      if (!value || typeof value !== 'object') return
      const node = value as { type: number, content?: string, tag?: string, children?: unknown[], props?: { type: number, name: string, value?: { content: string } }[] }
      if (node.type === 2 && node.content && /[A-Z]/i.test(node.content) && !['Deutsch', 'English'].includes(node.content.trim())) missing.push(`${path}: ${node.content.trim()}`)
      for (const prop of node.props ?? []) {
        if (prop.type === 6 && ['aria-label', 'placeholder', 'title', 'label'].includes(prop.name) && prop.value?.content) missing.push(`${path}: ${prop.value.content}`)
      }
      for (const child of node.children ?? []) visit(child)
    }
    visit(parseSFC(readFileSync(path, 'utf8')).descriptor.template?.ast)
  }
  expect(missing).toEqual([])
})
