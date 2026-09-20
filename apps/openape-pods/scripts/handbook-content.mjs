import { readFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

export function readHandbooks(directory, { checkImages = true } = {}) {
  const books = {}
  for (const locale of ['en', 'de']) {
    const file = locale === 'en' ? 'handbook.json' : 'handbook.de.json'
    const book = JSON.parse(readFileSync(join(directory, file), 'utf8'))
    if (!book.title || !book.subtitle || !Array.isArray(book.sections) || !book.sections.length) throw new Error(`Invalid handbook: ${file}`)
    const ids = new Set()
    for (const section of book.sections) {
      if (!/^[a-z-]+$/.test(section.id) || ids.has(section.id) || !section.title || !Array.isArray(section.paragraphs) || !section.paragraphs.length || !Array.isArray(section.steps)) throw new Error(`Invalid handbook section: ${file}/${section.id}`)
      ids.add(section.id)
      if (!section.image) continue
      if (basename(section.image) !== section.image || !/^handbook-[a-z-]+\.png$/.test(section.image)) throw new Error(`Invalid handbook image: ${section.image}`)
      if (checkImages && !existsSync(join(directory, 'images', section.image))) throw new Error(`Missing handbook image: ${section.image}`)
    }
    books[locale] = book
  }
  if (JSON.stringify(books.en.sections.map(section => section.id)) !== JSON.stringify(books.de.sections.map(section => section.id))) throw new Error('Handbook chapter parity failed')
  return books
}

export function sectionMarkdown(section, imageDirectory) {
  return [
    `## ${section.title}`,
    ...section.paragraphs,
    ...(section.steps.length ? [section.steps.map((text, index) => `${index + 1}. ${text}`).join('\n')] : []),
    ...(section.code ? [`\`\`\`javascript\n${section.code}\n\`\`\``] : []),
    ...(section.image ? [`![${section.title}](${imageDirectory}/${section.image})`] : []),
  ]
}
